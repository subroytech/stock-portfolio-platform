import express from 'express';
import * as authController from '../controllers/auth.controller';
import requireAuth from '../middleware/requireAuth';

const router = express.Router();

router.post('/signup', authController.signup);
router.post('/login', authController.login);
router.post('/logout', authController.logout);
// This router is mounted WITHOUT requireAuth at the app.ts level (signup/
// login/logout must stay public) - /me needs it applied per-route instead.
router.get('/me', requireAuth, authController.me);

export default router;
