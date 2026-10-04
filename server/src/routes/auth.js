import { Router } from 'express';
import { query, withTransaction } from '../db.js';
import { hashPassword, verifyPassword } from '../lib/passwords.js';
import { signAccessToken, issueRefreshToken, rotateRefreshToken, revokeRefreshToken, revokeAllRefreshTokens } from '../lib/tokens.js';
import { verifyGoogleIdToken } from '../lib/google.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { setAuthCookies, clearAuthCookies, setCsrfCookie } from '../lib/cookies.js';
import { readRefreshToken } from '../lib/session.js';
import { authLimiter, forgotPasswordLimiter } from '../middleware/rateLimit.js';
import { issueAuthToken, consumeAuthToken } from '../lib/authTokens.js';
import { sendPasswordResetEmail, sendVerificationEmail } from '../lib/email.js';
import { env } from '../env.js';

export const authRouter = Router();

async function createUserRow(client, { email, passwordHash, displayName, googleSub, emailVerified }) {
  const { rows } = await client.query(
    `INSERT INTO users (email, password_hash, display_name, google_sub, email_verified)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, email, display_name, email_verified`,
    [email, passwordHash ?? null, displayName ?? null, googleSub ?? null, Boolean(emailVerified)]
  );
  const user = rows[0];
  // Equivalent of the old handle_new_user() trigger on auth.users.
  await client.query('INSERT INTO user_preferences (user_id) VALUES ($1)', [user.id]);
  return user;
}

/**
 * Issues a session over both transports at once: the cookies as before,
 * and the same tokens in the response body.
 *
 * The body copy exists for browsers that discard the cookies — on iOS
 * every browser is WebKit, and WebKit blocks third-party cookies with no
 * site-side opt-out, so a Vercel page talking to a Render API never gets
 * to keep them (see lib/session.js). The client stores the body copy ONLY
 * after it has confirmed the cookies were dropped, so this changes nothing
 * for browsers where cookies work.
 *
 * no-store because a response body now carries credentials, and nothing in
 * front of this (Render's proxy, a corporate cache, the browser's own bfcache
 * for XHR) should be free to keep a copy.
 */
async function issueSession(res, userId) {
  const accessToken = await signAccessToken(userId);
  const refreshToken = await issueRefreshToken(userId);
  setAuthCookies(res, { accessToken, refreshToken });
  const csrfToken = setCsrfCookie(res);
  res.set('Cache-Control', 'no-store');
  res.json({ userId, accessToken, refreshToken, csrfToken });
}

/** Best-effort: a flaky email provider should never block account
 * creation or a resend request, so failures are logged, not thrown. */
async function sendVerificationEmailFor(userId, email) {
  try {
    const token = await issueAuthToken(userId, 'email_verification');
    const verifyUrl = `${env.appUrl}/verify-email?token=${token}`;
    await sendVerificationEmail(email, verifyUrl);
  } catch (err) {
    console.error('verification email error:', err);
  }
}

authRouter.post('/register', authLimiter, async (req, res) => {
  const { email, password, displayName } = req.body ?? {};
  if (!email || !password) return res.status(400).json({ error: 'email and password are required' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

  try {
    const existing = await query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) return res.status(409).json({ error: 'An account with that email already exists' });

    const passwordHash = await hashPassword(password);
    const user = await withTransaction((client) =>
      createUserRow(client, { email, passwordHash, displayName, emailVerified: false })
    );
    await issueSession(res, user.id);
    // Fire-and-forget: the session above is what the client is waiting on,
    // not this. See sendVerificationEmailFor for why failures don't throw.
    sendVerificationEmailFor(user.id, user.email);
  } catch (err) {
    console.error('register error:', err);
    res.status(500).json({ error: 'Could not create account' });
  }
});

authRouter.post('/login', authLimiter, async (req, res) => {
  const { email, password } = req.body ?? {};
  if (!email || !password) return res.status(400).json({ error: 'email and password are required' });

  try {
    const { rows } = await query('SELECT id, password_hash FROM users WHERE email = $1', [email]);
    const user = rows[0];
    if (!user || !(await verifyPassword(password, user.password_hash))) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    await issueSession(res, user.id);
  } catch (err) {
    console.error('login error:', err);
    res.status(500).json({ error: 'Could not sign in' });
  }
});

// Frontend posts the Google Identity Services `credential` (an ID token) here.
authRouter.post('/google', async (req, res) => {
  const { idToken } = req.body ?? {};
  if (!idToken) return res.status(400).json({ error: 'idToken is required' });

  try {
    const { sub, email, name } = await verifyGoogleIdToken(idToken);

    const existing = await query('SELECT id FROM users WHERE google_sub = $1 OR email = $2', [sub, email]);
    let userId = existing.rows[0]?.id;

    if (!userId) {
      const user = await withTransaction((client) =>
        createUserRow(client, { email, displayName: name, googleSub: sub, emailVerified: true })
      );
      userId = user.id;
    } else {
      await query('UPDATE users SET google_sub = $1 WHERE id = $2 AND google_sub IS NULL', [sub, userId]);
    }

    await issueSession(res, userId);
  } catch (err) {
    console.error('google sign-in error:', err);
    res.status(401).json({ error: 'Could not verify Google sign-in' });
  }
});

// The refresh token comes from the cookie normally, or from the request
// body for clients holding it themselves because the cookie was blocked.
authRouter.post('/refresh', async (req, res) => {
  const refreshToken = readRefreshToken(req);
  if (!refreshToken) return res.status(401).json({ error: 'Not signed in' });

  const rotated = await rotateRefreshToken(refreshToken);
  if (!rotated) {
    clearAuthCookies(res);
    return res.status(401).json({ error: 'Invalid or expired session' });
  }

  const accessToken = await signAccessToken(rotated.userId);
  setAuthCookies(res, { accessToken, refreshToken: rotated.refreshToken });
  const csrfToken = setCsrfCookie(res);
  res.set('Cache-Control', 'no-store');
  // Rotation means the old refresh token is now dead. A client holding its
  // own tokens must be given the replacement or its next refresh fails and
  // it is logged out mid-session.
  res.json({ userId: rotated.userId, accessToken, refreshToken: rotated.refreshToken, csrfToken });
});

authRouter.post('/logout', async (req, res) => {
  const refreshToken = readRefreshToken(req);
  if (refreshToken) await revokeRefreshToken(refreshToken);
  clearAuthCookies(res);
  res.status(204).end();
});

authRouter.get('/me', requireAuth, async (req, res) => {
  const { rows } = await query('SELECT id, email, display_name, email_verified FROM users WHERE id = $1', [req.userId]);
  if (!rows[0]) return res.status(404).json({ error: 'User not found' });
  res.json({
    id: rows[0].id,
    email: rows[0].email,
    displayName: rows[0].display_name,
    emailVerified: rows[0].email_verified,
  });
});

authRouter.patch('/me', requireAuth, async (req, res) => {
  const { displayName } = req.body ?? {};
  if (typeof displayName !== 'string' || displayName.trim().length === 0) {
    return res.status(400).json({ error: 'displayName is required' });
  }
  const { rows } = await query(
    'UPDATE users SET display_name = $1 WHERE id = $2 RETURNING id, email, display_name, email_verified',
    [displayName.trim(), req.userId]
  );
  if (!rows[0]) return res.status(404).json({ error: 'User not found' });
  res.json({
    id: rows[0].id,
    email: rows[0].email,
    displayName: rows[0].display_name,
    emailVerified: rows[0].email_verified,
  });
});

// Always responds the same way regardless of whether the email exists, so
// this can't be used to find out which addresses have accounts.
authRouter.post('/forgot-password', forgotPasswordLimiter, async (req, res) => {
  const { email } = req.body ?? {};
  const GENERIC_OK = { message: "If that email has an account, we've sent a reset link." };
  if (!email) return res.status(400).json({ error: 'email is required' });

  try {
    const { rows } = await query('SELECT id, email FROM users WHERE email = $1', [email]);
    const user = rows[0];
    if (user) {
      const token = await issueAuthToken(user.id, 'password_reset');
      const resetUrl = `${env.appUrl}/reset-password?token=${token}`;
      // Logged, not thrown: an email-provider hiccup shouldn't turn into a
      // 500 that tells an attacker this address IS registered.
      await sendPasswordResetEmail(user.email, resetUrl).catch((err) =>
        console.error('password reset email error:', err)
      );
    }
    res.json(GENERIC_OK);
  } catch (err) {
    console.error('forgot-password error:', err);
    // Same generic response even on an unexpected error - see above.
    res.json(GENERIC_OK);
  }
});

authRouter.post('/reset-password', async (req, res) => {
  const { token, password } = req.body ?? {};
  if (!token || !password) return res.status(400).json({ error: 'token and password are required' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

  try {
    const userId = await consumeAuthToken(token, 'password_reset');
    if (!userId) return res.status(400).json({ error: 'This reset link is invalid or has expired.' });

    const passwordHash = await hashPassword(password);
    await query('UPDATE users SET password_hash = $1 WHERE id = $2', [passwordHash, userId]);
    // Anyone still signed in with the old password (this device or another)
    // gets signed out - the whole point of a reset is that the old
    // credential can no longer be trusted.
    await revokeAllRefreshTokens(userId);
    res.json({ message: 'Password updated. Please sign in again.' });
  } catch (err) {
    console.error('reset-password error:', err);
    res.status(500).json({ error: 'Could not reset password' });
  }
});

authRouter.post('/verify-email', async (req, res) => {
  const { token } = req.body ?? {};
  if (!token) return res.status(400).json({ error: 'token is required' });

  try {
    const userId = await consumeAuthToken(token, 'email_verification');
    if (!userId) return res.status(400).json({ error: 'This verification link is invalid or has expired.' });

    await query('UPDATE users SET email_verified = true WHERE id = $1', [userId]);
    res.json({ message: 'Email verified.' });
  } catch (err) {
    console.error('verify-email error:', err);
    res.status(500).json({ error: 'Could not verify email' });
  }
});

authRouter.post('/resend-verification', authLimiter, requireAuth, async (req, res) => {
  try {
    const { rows } = await query('SELECT email, email_verified FROM users WHERE id = $1', [req.userId]);
    if (!rows[0]) return res.status(404).json({ error: 'User not found' });
    if (rows[0].email_verified) return res.json({ message: 'Your email is already verified.' });

    await sendVerificationEmailFor(req.userId, rows[0].email);
    res.json({ message: 'Verification email sent.' });
  } catch (err) {
    console.error('resend-verification error:', err);
    res.status(500).json({ error: 'Could not resend verification email' });
  }
});


