import rateLimit from 'express-rate-limit';

const handler = (req, res) => {
  res.status(429).json({ error: 'Too many attempts. Please wait a bit and try again.' });
};

/** Login + register: generous enough for a mistyped password a few times,
 * tight enough to make credential-stuffing/brute-force impractical. */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler,
});

/** Forgot-password: tighter than login, since each request sends an email.
 * Keyed by IP (via req.ip — see TRUST_PROXY in index.js), same as authLimiter. */
export const forgotPasswordLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  handler,
});

