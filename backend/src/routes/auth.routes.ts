import express from 'express';
import * as authController from '../controllers/auth.controller';
import requireAuth from '../middleware/requireAuth';
import requirePermission from '../middleware/requirePermission';

const router = express.Router();

router.post('/signup', authController.signup);
router.post('/login', authController.login);
router.post('/logout', authController.logout);
// This router is mounted WITHOUT requireAuth at the app.ts level (signup/
// login/logout must stay public) - /me needs it applied per-route instead.
router.get('/me', requireAuth, authController.me);

// Self-Registration & Password Policy - security questions feed the registration form (public,
// the full 15 for the user to pick 7 from) and the post-login "Manage Security Questions"
// screen (requireAuth, both the "mine" read and the full-replace write). Forgot Password's 3
// steps stay public (that's the whole point - no session exists yet). Change Password requires
// a valid session (it's "I know my current password," not recovery).
router.get('/security-questions', authController.securityQuestionsList);
router.get('/security-questions/mine', requireAuth, authController.securityQuestionsMine);
router.put('/security-questions', requireAuth, authController.updateSecurityQuestions);
router.post('/change-password', requireAuth, authController.changePassword);
router.post('/forgot-password/start', authController.forgotPasswordStart);
router.post('/forgot-password/verify', authController.forgotPasswordVerify);
router.post('/forgot-password/reset', authController.forgotPasswordReset);

// "Login-as" (CLAUDE.md's "Login-as" section) - impersonate needs the dedicated permission;
// stop-impersonating only needs a valid (impersonation) session, so anyone holding one can
// always end it.
router.post('/impersonate', requireAuth, requirePermission('users:impersonate'), authController.impersonate);
router.post('/stop-impersonating', requireAuth, authController.stopImpersonating);

export default router;
