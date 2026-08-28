import { Router } from 'express';
import { query, withTransaction } from '../db.js';
import { hashPassword, verifyPassword } from '../lib/passwords.js';
import { signAccessToken, issueRefreshToken, rotateRefreshToken, revokeRefreshToken } from '../lib/tokens.js';
import { verifyGoogleIdToken } from '../lib/google.js';
import { verifyAppleIdToken } from '../lib/apple.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { setAuthCookies, clearAuthCookies, setCsrfCookie, ACCESS_COOKIE, REFRESH_COOKIE } from '../lib/cookies.js';
import { authLimiter } from '../middleware/rateLimit.js';

export const authRouter = Router();

async function createUserRow(client, { email, passwordHash, displayName, googleSub, appleSub, emailVerified }) {
  const { rows } = await client.query(
    `INSERT INTO users (email, password_hash, display_name, google_sub, apple_sub, email_verified)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, email, display_name, email_verified`,
    [email, passwordHash ?? null, displayName ?? null, googleSub ?? null, appleSub ?? null, Boolean(emailVerified)]
  );
  const user = rows[0];
  // Equivalent of the old handle_new_user() trigger on auth.users.
  await client.query('INSERT INTO user_preferences (user_id) VALUES ($1)', [user.id]);
  return user;
}

async function issueSession(res, userId) {
  const accessToken = await signAccessToken(userId);
  const refreshToken = await issueRefreshToken(userId);
  setAuthCookies(res, { accessToken, refreshToken });
  setCsrfCookie(res);
  res.json({ userId });
}

authRouter.post('/register', authLimiter, async (req, res) => {
  const { email, password, displayName } = req.body ?? {};
  if (!email || !password) return res.status(400).json({ error: 'email and password are required' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

  try {
    const existing = await query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) return res.status(409).json({ error: 'An account with that email already exists' });

    const passwordHash = await hashPassword(password);
    // No mail server configured yet (no domain), so accounts are marked
    // verified at signup instead of going through an email link.
    const user = await withTransaction((client) =>
      createUserRow(client, { email, passwordHash, displayName, emailVerified: true })
    );
    await issueSession(res, user.id);
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

// Frontend posts the Apple `id_token` from AppleID.auth.signIn() here.
authRouter.post('/apple', async (req, res) => {
  const { idToken, displayName } = req.body ?? {};
  if (!idToken) return res.status(400).json({ error: 'idToken is required' });

  try {
    const { sub, email } = await verifyAppleIdToken(idToken);

    const existing = await query(
      'SELECT id FROM users WHERE apple_sub = $1 OR (email IS NOT NULL AND email = $2)',
      [sub, email]
    );
    let userId = existing.rows[0]?.id;

    if (!userId) {
      // Apple only sends `email` on the very first sign-in; if it's missing
      // (returning user re-consenting) we fall back to a synthetic
      // placeholder email tied to their Apple subject id.
      const effectiveEmail = email ?? `${sub}@apple.private`;
      const user = await withTransaction((client) =>
        createUserRow(client, { email: effectiveEmail, displayName, appleSub: sub, emailVerified: true })
      );
      userId = user.id;
    } else {
      await query('UPDATE users SET apple_sub = $1 WHERE id = $2 AND apple_sub IS NULL', [sub, userId]);
    }

    await issueSession(res, userId);
  } catch (err) {
    console.error('apple sign-in error:', err);
    res.status(401).json({ error: 'Could not verify Apple sign-in' });
  }
});

authRouter.post('/refresh', async (req, res) => {
  const refreshToken = req.cookies?.[REFRESH_COOKIE];
  if (!refreshToken) return res.status(401).json({ error: 'Not signed in' });

  const rotated = await rotateRefreshToken(refreshToken);
  if (!rotated) {
    clearAuthCookies(res);
    return res.status(401).json({ error: 'Invalid or expired session' });
  }

  const accessToken = await signAccessToken(rotated.userId);
  setAuthCookies(res, { accessToken, refreshToken: rotated.refreshToken });
  setCsrfCookie(res);
  res.json({ userId: rotated.userId });
});

authRouter.post('/logout', async (req, res) => {
  const refreshToken = req.cookies?.[REFRESH_COOKIE];
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


