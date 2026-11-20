import { Router, type NextFunction, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import { env } from '../../config/env';
import { requireDatabase } from '../../database/connection';
import { authenticateOptional, authenticateRequired } from '../../middleware/auth.middleware';
import { AppError } from '../../middleware/error.middleware';
import {
  adminLoginController,
  changePasswordController,
  completeSocialEmailController,
  confirmOAuthLinkController,
  facebookOAuthCallbackController,
  facebookOAuthRedirectController,
  facebookOAuthUrlController,
  forgotPasswordController,
  getAuthProviders,
  getLinkedProvidersController,
  googleOAuthCallbackController,
  googleOAuthRedirectController,
  googleOAuthUrlController,
  identifyEmailController,
  listSessionsController,
  loginController,
  logoutAllSessionsController,
  logoutController,
  meController,
  registerController,
  resendVerificationController,
  resetPasswordController,
  revokeSessionController,
  setPasswordController,
  unlinkProviderController,
  updateProfileController,
  uploadProfileAvatarController,
  removeProfileAvatarController,
  verifyEmailController,
} from './auth.controller';

const router = Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, code: 'RATE_LIMITED', error: 'Too many authentication attempts. Please try again shortly.' },
});

const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) {
      callback(new AppError(400, 'UNSUPPORTED_IMAGE_TYPE', 'Only JPEG, PNG, and WebP images are supported.'));
      return;
    }
    callback(null, true);
  },
});
const avatarUploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 8,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, code: 'RATE_LIMITED', error: 'Too many photo uploads. Please try again later.' },
});

function requireOAuthLinkRequestProtection(req: Request, _res: Response, next: NextFunction): void {
  const origin = req.get('origin');
  const isJson = Boolean(req.is('application/json'));
  const trustedOrigins = [env.CLIENT_URL, env.APP_URL].flatMap((configuredUrl) => {
    try {
      const parsed = new URL(configuredUrl);
      return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? [parsed.origin] : [];
    } catch {
      return [];
    }
  });

  if (!origin || !trustedOrigins.includes(origin) || !isJson) {
    next(new AppError(403, 'CSRF_VALIDATION_FAILED', 'OAuth account-link request failed origin verification.'));
    return;
  }
  next();
}

router.get('/providers', getAuthProviders);
router.post('/identify', authLimiter, identifyEmailController);
router.post('/register', authLimiter, requireDatabase, registerController);
router.post('/login', authLimiter, requireDatabase, loginController);
router.post('/admin/login', authLimiter, requireDatabase, adminLoginController);
router.post('/logout', authenticateOptional, logoutController);
router.get('/me', requireDatabase, authenticateRequired, meController);
router.patch('/profile', requireDatabase, authenticateRequired, updateProfileController);
router.post('/profile/avatar', avatarUploadLimiter, requireDatabase, authenticateRequired, avatarUpload.single('file'), uploadProfileAvatarController);
router.delete('/profile/avatar', requireDatabase, authenticateRequired, removeProfileAvatarController);
router.post('/change-password', requireDatabase, authenticateRequired, changePasswordController);
router.post('/set-password', requireDatabase, authenticateRequired, setPasswordController);
router.post('/verify-email', authLimiter, requireDatabase, verifyEmailController);
router.get('/verify-email', authLimiter, requireDatabase, verifyEmailController);
router.post('/resend-verification', authLimiter, requireDatabase, resendVerificationController);
router.post('/forgot-password', authLimiter, requireDatabase, forgotPasswordController);
router.post('/reset-password', authLimiter, requireDatabase, resetPasswordController);

router.post('/oauth/complete-email', authLimiter, requireDatabase, completeSocialEmailController);
router.post('/oauth/confirm-link', authLimiter, requireOAuthLinkRequestProtection, requireDatabase, confirmOAuthLinkController);
router.get('/linked-providers', requireDatabase, authenticateRequired, getLinkedProvidersController);
router.delete('/unlink/:provider', requireDatabase, authenticateRequired, unlinkProviderController);
router.get('/sessions', requireDatabase, authenticateRequired, listSessionsController);
router.post('/sessions/:sessionId/revoke', requireDatabase, authenticateRequired, revokeSessionController);
router.post('/logout-all', requireDatabase, authenticateRequired, logoutAllSessionsController);

router.get('/oauth/google/url', authenticateOptional, googleOAuthUrlController);
router.get('/oauth/google', authenticateOptional, googleOAuthRedirectController);
router.get(['/oauth/google/callback', '/oauth/google/callback/'], requireDatabase, authenticateOptional, googleOAuthCallbackController);

router.get('/oauth/facebook/url', authenticateOptional, facebookOAuthUrlController);
router.get('/oauth/facebook', authenticateOptional, facebookOAuthRedirectController);
router.get(['/oauth/facebook/callback', '/oauth/facebook/callback/'], requireDatabase, authenticateOptional, facebookOAuthCallbackController);

export default router;
