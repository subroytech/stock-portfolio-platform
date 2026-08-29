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

// "Login-as" (CLAUDE.md's "Login-as" section) - impersonate needs the dedicated permission;
// stop-impersonating only needs a valid (impersonation) session, so anyone holding one can
// always end it.
router.post('/impersonate', requireAuth, requirePermission('users:impersonate'), authController.impersonate);
router.post('/stop-impersonating', requireAuth, authController.stopImpersonating);

export default router;
