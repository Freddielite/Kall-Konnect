import rateLimit from 'express-rate-limit';
import { normalizeEmail } from '../lib/validate.js';

const handler = (req, res) => {
  res.status(429).json({ error: 'Too many attempts. Please wait a bit and try again.' });
};

const common = { standardHeaders: true, legacyHeaders: false, handler };

/** Login, per IP. Only FAILED attempts count, so a family or office behind
 * one IP address can sign in all day; a guesser gets 10 tries per 15 min.
 * Keyed by req.ip — see TRUST_PROXY in index.js. */
export const loginIpLimiter = rateLimit({
  ...common,
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true,
});

/**
 * Login, per account, across all IPs: stops a botnet spreading guesses for
 * one account over thousands of addresses, which the per-IP limit can't see.
 *
 * Deliberately loose (30 failures an hour) and temporary, never a hard
 * lockout: a hard lock lets anyone who knows your email lock you out the
 * night before you need the app. At 30/hour, guessing even an 8-character
 * password is hopeless, and the account's owner is only ever blocked while
 * someone is actively hammering it — and "Forgot password" has its own
 * limiter, so they still have a way in.
 */
export const loginAccountLimiter = rateLimit({
  ...common,
  windowMs: 60 * 60 * 1000,
  limit: 30,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => `acct:${normalizeEmail(req.body?.email) ?? 'invalid'}`,
});

/** Account creation, per IP. Counts every attempt (successful ones are the
 * point of an abuse run). */
export const registerLimiter = rateLimit({
  ...common,
  windowMs: 60 * 60 * 1000,
  limit: 10,
});

/** Forgot-password: tighter than login, since each request sends an email.
 * Keyed by IP (via req.ip — see TRUST_PROXY in index.js). */
export const forgotPasswordLimiter = rateLimit({
  ...common,
  windowMs: 60 * 60 * 1000,
  limit: 5,
});

/** Endpoints that consume a one-time token (reset password, verify email)
 * or resend one. The tokens are 256-bit so guessing is not the concern;
 * this just caps load and email volume. */
export const tokenLimiter = rateLimit({
  ...common,
  windowMs: 15 * 60 * 1000,
  limit: 20,
});
