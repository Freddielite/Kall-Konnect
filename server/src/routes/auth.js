import { Router } from 'express';
import { query, withTransaction } from '../db.js';
import { hashPassword, verifyPassword } from '../lib/passwords.js';
import { signAccessToken, issueRefreshToken, rotateRefreshToken, revokeRefreshToken, revokeAllSessions } from '../lib/tokens.js';
import { verifyGoogleIdToken } from '../lib/google.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { setAuthCookies, clearAuthCookies, setCsrfCookie } from '../lib/cookies.js';
import { readRefreshToken } from '../lib/session.js';
import {
  loginIpLimiter, loginAccountLimiter, registerLimiter, forgotPasswordLimiter, tokenLimiter,
} from '../middleware/rateLimit.js';
import { issueAuthToken, consumeAuthToken, invalidateAuthTokens } from '../lib/authTokens.js';
import { pick, str, email as emailSpec, password as passwordSpec, timeZone, optional, normalizeEmail, ValidationError } from '../lib/validate.js';
import { disconnectUser } from '../ws.js';
import { sendPasswordResetEmail, sendVerificationEmail } from '../lib/email.js';
import { env } from '../env.js';

export const authRouter = Router();

async function createUserRow(client, { email, passwordHash, displayName, googleSub, emailVerified, timezone }) {
  const { rows } = await client.query(
    `INSERT INTO users (email, password_hash, display_name, google_sub, email_verified, timezone)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, email, display_name, email_verified`,
    [email, passwordHash ?? null, displayName ?? null, googleSub ?? null, Boolean(emailVerified), timezone ?? null]
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

/** All accounts whose email matches, case-insensitively. Usually zero or
 * one; more only for pre-existing duplicates flagged by migration 012. */
async function usersByEmail(normalized, columns = 'id, email, password_hash') {
  const { rows } = await query(
    `SELECT ${columns} FROM users WHERE lower(email) = $1 ORDER BY created_at`,
    [normalized]
  );
  return rows;
}

const REGISTER_FIELDS = {
  email: emailSpec(),
  password: passwordSpec(),
  displayName: optional(str({ max: 100, nullable: true }), null),
  timezone: optional(timeZone(), null),
};

authRouter.post('/register', registerLimiter, async (req, res) => {
  const { email, password, displayName, timezone } = pick(req.body ?? {}, REGISTER_FIELDS);

  const existing = await usersByEmail(email, 'id');
  if (existing.length > 0) return res.status(409).json({ error: 'An account with that email already exists' });

  const passwordHash = await hashPassword(password);
  let user;
  try {
    user = await withTransaction((client) =>
      createUserRow(client, { email, passwordHash, displayName, emailVerified: false, timezone })
    );
  } catch (err) {
    // Two sign-ups for the same address racing past the check above.
    if (err.code === '23505') return res.status(409).json({ error: 'An account with that email already exists' });
    throw err;
  }
  await issueSession(res, user.id);
  // Fire-and-forget: the session above is what the client is waiting on,
  // not this. See sendVerificationEmailFor for why failures don't throw.
  sendVerificationEmailFor(user.id, user.email);
});

authRouter.post('/login', loginIpLimiter, loginAccountLimiter, async (req, res) => {
  const { email, password } = req.body ?? {};
  const normalized = normalizeEmail(email);
  if (!normalized || typeof password !== 'string' || password.length === 0) {
    return res.status(400).json({ error: 'email and password are required' });
  }

  // Usually one match. Accounts flagged as case-duplicates by migration 012
  // can share an address; each keeps working with its own password.
  const candidates = await usersByEmail(normalized);
  let userId = null;
  if (candidates.length === 0) {
    await verifyPassword(password, null); // same timing as a wrong password
  }
  for (const user of candidates) {
    if (await verifyPassword(password, user.password_hash)) {
      userId = user.id;
      break;
    }
  }
  if (!userId) return res.status(401).json({ error: 'Invalid email or password' });
  await issueSession(res, userId);
});

// Frontend posts the Google Identity Services `credential` (an ID token) here.
authRouter.post('/google', async (req, res) => {
  const { idToken } = req.body ?? {};
  if (!idToken) return res.status(400).json({ error: 'idToken is required' });

  try {
    const { sub, email: rawEmail, emailVerified, name } = await verifyGoogleIdToken(idToken);
    const email = normalizeEmail(rawEmail);

    // An account already linked to this Google identity wins outright.
    const bySub = await query('SELECT id FROM users WHERE google_sub = $1', [sub]);
    let userId = bySub.rows[0]?.id;

    if (!userId) {
      // Linking by email, or creating an account under that email, is only
      // safe when Google has verified the person owns the address.
      if (!email || !emailVerified) {
        return res.status(401).json({ error: 'Your Google account email is not verified.' });
      }
      const byEmail = await usersByEmail(email, 'id');
      if (byEmail.length > 0) {
        userId = byEmail[0].id; // oldest, if migration 012 flagged duplicates
        await query('UPDATE users SET google_sub = $1, email_verified = true WHERE id = $2 AND google_sub IS NULL', [sub, userId]);
      } else {
        const timezone = REGISTER_FIELDS.timezone(req.body?.timezone, 'timezone');
        const user = await withTransaction((client) =>
          createUserRow(client, { email, displayName: name, googleSub: sub, emailVerified: true, timezone })
        );
        userId = user.id;
      }
    }

    await issueSession(res, userId);
  } catch (err) {
    if (err instanceof ValidationError) throw err;
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

/** "Sign out everywhere": ends every session on every device, including
 * this one and any connected MCP client. For a lost phone, or "I think
 * someone else is in my account". */
authRouter.post('/logout-all', requireAuth, async (req, res) => {
  await revokeAllSessions(req.userId);
  disconnectUser(req.userId);
  clearAuthCookies(res);
  res.status(204).end();
});

authRouter.get('/me', requireAuth, async (req, res) => {
  const { rows } = await query(
    'SELECT id, email, display_name, email_verified, timezone, password_hash IS NOT NULL AS has_password FROM users WHERE id = $1',
    [req.userId]
  );
  if (!rows[0]) return res.status(404).json({ error: 'User not found' });
  res.json({
    id: rows[0].id,
    email: rows[0].email,
    displayName: rows[0].display_name,
    emailVerified: rows[0].email_verified,
    timezone: rows[0].timezone,
    // Decides how account deletion is confirmed (password, or typed email).
    hasPassword: rows[0].has_password,
  });
});

const ME_FIELDS = {
  displayName: str({ min: 1, max: 100 }),
  timezone: timeZone(),
};

authRouter.patch('/me', requireAuth, async (req, res) => {
  const updates = pick(req.body ?? {}, ME_FIELDS, { partial: true });
  const columns = { displayName: 'display_name', timezone: 'timezone' };
  const keys = Object.keys(updates);
  if (keys.length === 0) return res.status(400).json({ error: 'Nothing to update' });

  const { rows } = await query(
    `UPDATE users SET ${keys.map((k, i) => `${columns[k]} = $${i + 1}`).join(', ')}
      WHERE id = $${keys.length + 1}
      RETURNING id, email, display_name, email_verified, timezone`,
    [...keys.map((k) => updates[k]), req.userId]
  );
  if (!rows[0]) return res.status(404).json({ error: 'User not found' });
  res.json({
    id: rows[0].id,
    email: rows[0].email,
    displayName: rows[0].display_name,
    emailVerified: rows[0].email_verified,
    timezone: rows[0].timezone,
  });
});

// Always responds the same way regardless of whether the email exists, so
// this can't be used to find out which addresses have accounts.
authRouter.post('/forgot-password', forgotPasswordLimiter, async (req, res) => {
  const GENERIC_OK = { message: "If that email has an account, we've sent a reset link." };
  const email = normalizeEmail(req.body?.email);
  if (!email) return res.status(400).json({ error: 'A valid email is required' });

  try {
    // One link per matching account (more than one only for duplicates
    // flagged by migration 012), each sent to that account's own address.
    for (const user of await usersByEmail(email, 'id, email')) {
      const token = await issueAuthToken(user.id, 'password_reset');
      const resetUrl = `${env.appUrl}/reset-password?token=${token}`;
      // Not awaited, and logged rather than thrown: waiting on the email
      // provider would make "registered" responses measurably slower than
      // "not registered" ones, and a provider error must not become a 500
      // that tells an attacker this address IS registered.
      sendPasswordResetEmail(user.email, resetUrl).catch((err) =>
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

authRouter.post('/reset-password', tokenLimiter, async (req, res) => {
  const { token } = req.body ?? {};
  if (typeof token !== 'string' || !token) return res.status(400).json({ error: 'token is required' });
  const { password } = pick(req.body, { password: passwordSpec() });

  const userId = await consumeAuthToken(token, 'password_reset');
  if (!userId) return res.status(400).json({ error: 'This reset link is invalid or has expired.' });

  const passwordHash = await hashPassword(password);
  await query('UPDATE users SET password_hash = $1 WHERE id = $2', [passwordHash, userId]);
  // The old credential can no longer be trusted: end every session on
  // every device right now (not when access tokens expire), and kill any
  // other reset links still sitting in the inbox.
  await revokeAllSessions(userId);
  await invalidateAuthTokens(userId, 'password_reset');
  disconnectUser(userId);
  res.json({ message: 'Password updated. Please sign in again.' });
});

authRouter.post('/verify-email', tokenLimiter, async (req, res) => {
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

authRouter.post('/resend-verification', tokenLimiter, requireAuth, async (req, res) => {
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


