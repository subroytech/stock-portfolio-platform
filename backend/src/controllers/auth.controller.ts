import { Request, Response, NextFunction, CookieOptions } from 'express';
import * as authService from '../services/auth.service';
import * as rolesService from '../services/roles.service';
import * as impersonationService from '../services/impersonation.service';
import * as securityQuestionService from '../services/securityQuestion.service';
import * as passwordHistoryService from '../services/passwordHistory.service';
import * as usersService from '../services/users.service';
import { validatePasswordPolicy } from '../utils/passwordPolicy';
import env from '../config/env';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Self-Registration & Password Policy - how many questions are offered/answered at registration
// vs. challenged at Forgot Password time. Confirmed with the user: all 7 offered are answered
// and saved (not just 5); 4 of those 7 are randomly challenged on Forgot Password.
const REGISTRATION_QUESTION_COUNT = 7;
const CHALLENGE_QUESTION_COUNT = 4;

function cookieOptions(maxAge: number = env.jwtExpiresInMs): CookieOptions {
  return {
    httpOnly: true,
    secure: env.nodeEnv === 'production',
    sameSite: 'lax',
    maxAge,
  };
}

// Shared by impersonate/stopImpersonating - the full resolved session shape the frontend
// expects (api/auth.ts's User), for a userId already confirmed to exist by the caller.
async function resolveSession(userId: string, impersonating: boolean) {
  const user = (await authService.findUserById(userId))!;
  const roles = await rolesService.getUserRoles(userId);
  const permissions = await rolesService.getUserPermissions(userId);
  return { ...user, roles, permissions, impersonating };
}

function emailLocalPart(email: string): string {
  return email.split('@')[0] ?? '';
}

// Self-Registration & Password Policy: full "Register New User" flow, replacing the old bare
// email+8-char-password signup in place (same POST /auth/signup route - no rename). Two
// deliberate behavior changes from the old signup: the account starts `status: 'pending'`
// instead of `'active'`, and it is NOT given the baseline 'user' role - both a manual admin
// step now (Manage Users), see CLAUDE.md's "Self-Registration & Password Policy" section.
export async function signup(req: Request, res: Response, next: NextFunction): Promise<void> {
  const { email, password, firstName, lastName, securityAnswers } = req.body || {};

  if (typeof email !== 'string' || !EMAIL_RE.test(email)) {
    res.status(400).json({ error: 'A valid email is required.' });
    return;
  }
  if (typeof firstName !== 'string' || !firstName.trim() || typeof lastName !== 'string' || !lastName.trim()) {
    res.status(400).json({ error: 'First name and last name are required.' });
    return;
  }
  if (typeof password !== 'string') {
    res.status(400).json({ error: 'A password is required.' });
    return;
  }
  const policyErrors = validatePasswordPolicy(password, { firstName, lastName, emailLocalPart: emailLocalPart(email) });
  if (policyErrors.length) {
    res.status(400).json({ error: policyErrors[0], errors: policyErrors });
    return;
  }
  if (!Array.isArray(securityAnswers) || securityAnswers.length !== REGISTRATION_QUESTION_COUNT) {
    res.status(400).json({ error: `Exactly ${REGISTRATION_QUESTION_COUNT} security question answers are required.` });
    return;
  }
  for (const a of securityAnswers) {
    if (typeof a?.questionId !== 'string' || typeof a?.answer !== 'string' || !a.answer.trim() || a.answer.trim().length > 20) {
      res.status(400).json({ error: 'Each security question answer must be 1-20 characters.' });
      return;
    }
  }

  try {
    const existing = await authService.findUserByEmail(email);
    if (existing) {
      res.status(409).json({ error: 'An account with this email already exists.' });
      return;
    }

    const passwordHash = await authService.hashPassword(password);
    const user = await authService.createUser(email, passwordHash, 'pending', firstName.trim(), lastName.trim());
    await securityQuestionService.saveUserAnswers(user.id, securityAnswers, REGISTRATION_QUESTION_COUNT);
    await passwordHistoryService.recordPassword(user.id, passwordHash);
    const token = authService.signToken(user.id);

    res.cookie(authService.AUTH_COOKIE_NAME, token, cookieOptions());
    res.status(201).json(await resolveSession(user.id, false));
  } catch (err) {
    if (err instanceof authService.EmailAlreadyExistsError) {
      res.status(409).json({ error: err.message });
      return;
    }
    if (err instanceof securityQuestionService.InvalidQuestionSelectionError) {
      res.status(400).json({ error: err.message });
      return;
    }
    next(err);
  }
}

export async function login(req: Request, res: Response, next: NextFunction): Promise<void> {
  const { email, password } = req.body || {};

  if (typeof email !== 'string' || typeof password !== 'string') {
    res.status(400).json({ error: 'Email and password are required.' });
    return;
  }

  try {
    const user = await authService.login(email, password);
    const token = authService.signToken(user.id);

    res.cookie(authService.AUTH_COOKIE_NAME, token, cookieOptions());
    // 'pending' accounts log in successfully (Self-Registration & Password Policy) - the
    // frontend is what gates them down to the banner-only view (ProtectedRoute.tsx), based on
    // this same status field returned here (and by GET /auth/me right after).
    res.json(await resolveSession(user.id, false));
  } catch (err) {
    if (err instanceof authService.InvalidCredentialsError) {
      res.status(401).json({ error: err.message });
      return;
    }
    next(err);
  }
}

export function logout(_req: Request, res: Response): void {
  res.clearCookie(authService.AUTH_COOKIE_NAME, cookieOptions());
  res.json({ success: true });
}

// Fixes a real pre-existing gap: there was no way for the frontend to learn
// the current user's identity/roles after a page reload (see
// frontend/src/api/auth.ts's old /portfolios-probe + module-cache workaround).
export async function me(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = await authService.findUserById(req.user!.id);
    if (!user) {
      res.status(401).json({ error: 'Invalid or expired session.' });
      return;
    }
    const roles = await rolesService.getUserRoles(user.id);
    const permissions = await rolesService.getUserPermissions(user.id);
    res.json({ ...user, roles, permissions, impersonating: !!req.user!.impersonatedBy });
  } catch (err) {
    next(err);
  }
}

// POST /auth/impersonate - "Login-as" (users:impersonate, admin-master only in practice - see
// roles.service.ts's ADMIN_MASTER_ONLY_PERMISSIONS). Issues a new, shorter-lived token for the
// target user, carrying the admin's own id as impersonatedBy so the session can always find its
// way back - no second cookie/session-store needed.
export async function impersonate(req: Request, res: Response, next: NextFunction): Promise<void> {
  const { userId } = req.body || {};
  if (typeof userId !== 'string' || !userId.trim()) {
    res.status(400).json({ error: 'A userId is required.' });
    return;
  }
  // No nested impersonation - always return to your own account first. Checked here (not just
  // relying on startImpersonation) since it's about the CALLER's own current session state, not
  // the target.
  if (req.user!.impersonatedBy) {
    res.status(409).json({ error: 'Already impersonating a user - return to your own account first.' });
    return;
  }

  try {
    await impersonationService.startImpersonation(req.user!.id, userId.trim());
    const token = authService.signToken(userId.trim(), { impersonatedBy: req.user!.id, expiresIn: env.impersonationExpiresIn });
    res.cookie(authService.AUTH_COOKIE_NAME, token, cookieOptions(env.impersonationExpiresInMs));
    res.json(await resolveSession(userId.trim(), true));
  } catch (err) {
    if (err instanceof impersonationService.TargetUserNotFoundError) {
      res.status(404).json({ error: err.message });
      return;
    }
    if (err instanceof impersonationService.CannotImpersonateAdminError) {
      res.status(403).json({ error: err.message });
      return;
    }
    next(err);
  }
}

// POST /auth/stop-impersonating - restores the original admin's own (normal-length) session.
// requireAuth only, no extra permission needed - if you're holding a valid impersonation token
// at all, you're always allowed to end it.
export async function stopImpersonating(req: Request, res: Response, next: NextFunction): Promise<void> {
  const adminId = req.user!.impersonatedBy;
  if (!adminId) {
    res.status(400).json({ error: 'Not currently impersonating a user.' });
    return;
  }

  try {
    await impersonationService.endImpersonation(adminId, req.user!.id);
    const token = authService.signToken(adminId);
    res.cookie(authService.AUTH_COOKIE_NAME, token, cookieOptions());
    res.json(await resolveSession(adminId, false));
  } catch (err) {
    next(err);
  }
}

// GET /auth/security-questions/random - public, feeds the registration form's 7 questions.
// Stateless (see securityQuestion.service.ts's own note) - nothing is recorded about what was
// offered to a given page load.
export async function securityQuestionsRandom(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const questions = await securityQuestionService.getRandomActiveQuestions(REGISTRATION_QUESTION_COUNT);
    res.json({ questions });
  } catch (err) {
    next(err);
  }
}

// POST /auth/change-password - requireAuth. The logged-in "I know my current password" path,
// distinct from the security-question-based Forgot Password flow below.
export async function changePassword(req: Request, res: Response, next: NextFunction): Promise<void> {
  const { currentPassword, newPassword } = req.body || {};
  if (typeof currentPassword !== 'string' || typeof newPassword !== 'string') {
    res.status(400).json({ error: 'Current and new password are required.' });
    return;
  }

  try {
    const userId = req.user!.id;
    const [currentHash, user] = await Promise.all([authService.getPasswordHashById(userId), authService.findUserById(userId)]);
    if (!currentHash || !user) {
      res.status(401).json({ error: 'Invalid or expired session.' });
      return;
    }
    if (!(await authService.verifyPassword(currentPassword, currentHash))) {
      res.status(401).json({ error: 'Current password is incorrect.' });
      return;
    }

    const policyErrors = validatePasswordPolicy(newPassword, {
      firstName: user.firstName, lastName: user.lastName, emailLocalPart: emailLocalPart(user.email),
    });
    if (policyErrors.length) {
      res.status(400).json({ error: policyErrors[0], errors: policyErrors });
      return;
    }
    if (await passwordHistoryService.isPasswordReused(userId, newPassword)) {
      res.status(400).json({ error: 'New password must not match any of your last 5 passwords.' });
      return;
    }

    const newHash = await authService.hashPassword(newPassword);
    await usersService.updateUserPassword(userId, newHash);
    await passwordHistoryService.recordPassword(userId, newHash);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
}

// POST /auth/forgot-password/start - public. { email } -> 4 randomly-challenged questions from
// the account's own 7 saved answers, plus a short-lived signed challenge token carrying exactly
// which 4 question ids were offered (so /verify below can't be tricked into checking a
// different set than what the user actually saw). Deliberately not anti-enumeration-safe (404s
// plainly) - see the plan's own "deliberate scope boundaries" note; matches this app's existing
// precedent of not hiding account existence everywhere (e.g. signup's 409 on a duplicate email).
export async function forgotPasswordStart(req: Request, res: Response, next: NextFunction): Promise<void> {
  const { email } = req.body || {};
  if (typeof email !== 'string' || !EMAIL_RE.test(email)) {
    res.status(400).json({ error: 'A valid email is required.' });
    return;
  }

  try {
    const user = await authService.findUserByEmail(email);
    if (!user) {
      res.status(404).json({ error: 'No account found with that email.' });
      return;
    }
    const questions = await securityQuestionService.getRandomChallengeQuestions(user.id, CHALLENGE_QUESTION_COUNT);
    const challengeToken = authService.signPasswordResetChallengeToken(user.id, questions.map((q) => q.id));
    res.json({ challengeToken, questions });
  } catch (err) {
    if (err instanceof securityQuestionService.NoSecurityAnswersError) {
      res.status(404).json({ error: err.message });
      return;
    }
    next(err);
  }
}

// POST /auth/forgot-password/verify - public. { challengeToken, answers[4] } -> a resetToken
// once ALL 4 are correct. Never reveals which answer(s) were wrong (same anti-tamper spirit as
// login's own generic-error precedent).
export async function forgotPasswordVerify(req: Request, res: Response, next: NextFunction): Promise<void> {
  const { challengeToken, answers } = req.body || {};
  if (typeof challengeToken !== 'string' || !Array.isArray(answers) || answers.length !== CHALLENGE_QUESTION_COUNT) {
    res.status(400).json({ error: `A challenge token and ${CHALLENGE_QUESTION_COUNT} answers are required.` });
    return;
  }

  let userId: string;
  let questionIds: string[];
  try {
    ({ userId, questionIds } = authService.verifyPasswordResetChallengeToken(challengeToken));
  } catch {
    res.status(401).json({ error: 'This verification has expired or is invalid - please start over.' });
    return;
  }

  const answeredIds = new Set(answers.map((a: { questionId?: unknown }) => a?.questionId));
  if (answeredIds.size !== questionIds.length || !questionIds.every((id) => answeredIds.has(id))) {
    res.status(400).json({ error: 'Answers do not match the challenged questions.' });
    return;
  }

  try {
    const correct = await securityQuestionService.verifyAnswers(userId, answers);
    if (!correct) {
      res.status(401).json({ error: 'One or more answers were incorrect.' });
      return;
    }
    res.json({ resetToken: authService.signPasswordResetToken(userId) });
  } catch (err) {
    next(err);
  }
}

// POST /auth/forgot-password/reset - public. { resetToken, newPassword } -> sets the new
// password, same policy + last-5-history checks as everywhere else.
export async function forgotPasswordReset(req: Request, res: Response, next: NextFunction): Promise<void> {
  const { resetToken, newPassword } = req.body || {};
  if (typeof resetToken !== 'string' || typeof newPassword !== 'string') {
    res.status(400).json({ error: 'A reset token and new password are required.' });
    return;
  }

  let userId: string;
  try {
    ({ userId } = authService.verifyPasswordResetToken(resetToken));
  } catch {
    res.status(401).json({ error: 'This reset link has expired or is invalid - please start over.' });
    return;
  }

  try {
    const user = await authService.findUserById(userId);
    if (!user) {
      res.status(404).json({ error: 'Account not found.' });
      return;
    }

    const policyErrors = validatePasswordPolicy(newPassword, {
      firstName: user.firstName, lastName: user.lastName, emailLocalPart: emailLocalPart(user.email),
    });
    if (policyErrors.length) {
      res.status(400).json({ error: policyErrors[0], errors: policyErrors });
      return;
    }
    if (await passwordHistoryService.isPasswordReused(userId, newPassword)) {
      res.status(400).json({ error: 'New password must not match any of your last 5 passwords.' });
      return;
    }

    const newHash = await authService.hashPassword(newPassword);
    await usersService.updateUserPassword(userId, newHash);
    await passwordHistoryService.recordPassword(userId, newHash);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
}
