import crypto from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import { env } from '../env.js';
import { query } from '../db.js';

const secretKey = new TextEncoder().encode(env.jwtSecret);

/** A rotated-out refresh token presented again within this window is
 * treated as a benign race (two tabs refreshing at once), not theft. */
const REUSE_GRACE_MS = 60_000;

/** Access tokens carry the user's session_version as `sv`. Bumping that
 * column (sign out everywhere, password reset, detected token theft)
 * invalidates every access token already issued — see requireAuth. */
export async function signAccessToken(userId) {
  const { rows } = await query('SELECT session_version FROM users WHERE id = $1', [userId]);
  const sv = rows[0]?.session_version ?? 0;
  return new SignJWT({ sub: userId, sv })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${env.accessTokenTtlSeconds}s`)
    .sign(secretKey);
}

/** Checks signature and expiry only. Returns { userId, sv } or null.
 * Callers that grant access must also call isSessionCurrent. */
export async function verifyAccessToken(token) {
  if (typeof token !== 'string') return null;
  try {
    const { payload } = await jwtVerify(token, secretKey, { algorithms: ['HS256'] });
    if (typeof payload.sub !== 'string') return null;
    return { userId: payload.sub, sv: Number.isInteger(payload.sv) ? payload.sv : 0 };
  } catch {
    return null;
  }
}

/** True if the user still exists and the token's session version is
 * current. Tokens issued before migration 014 carry no sv and count as 0. */
export async function isSessionCurrent({ userId, sv }) {
  const { rows } = await query('SELECT session_version FROM users WHERE id = $1', [userId]);
  return rows.length > 0 && rows[0].session_version === sv;
}

export function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/** Issues a new opaque refresh token, stores its hash, returns the raw token. */
export async function issueRefreshToken(userId) {
  const raw = crypto.randomBytes(48).toString('base64url');
  const expiresAt = new Date(Date.now() + env.refreshTokenTtlDays * 86_400_000);
  await query(
    'INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
    [userId, hashToken(raw), expiresAt]
  );
  return raw;
}

/**
 * Validates and rotates a refresh token. Returns { userId, refreshToken }
 * or null.
 *
 * The claim is a single UPDATE ... WHERE revoked_at IS NULL, so two
 * concurrent requests with the same token can't both succeed (the old
 * SELECT-then-UPDATE let both through and minted two live tokens).
 *
 * Reuse detection: a token that was rotated out more than REUSE_GRACE_MS
 * ago being presented again means a copy of it exists somewhere else, so
 * every session for that user is killed and they must sign in again.
 */
export async function rotateRefreshToken(raw) {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  const hash = hashToken(raw);
  const { rows } = await query(
    `UPDATE refresh_tokens SET revoked_at = now(), replaced_at = now()
      WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now()
      RETURNING user_id`,
    [hash]
  );
  if (rows[0]) {
    return { userId: rows[0].user_id, refreshToken: await issueRefreshToken(rows[0].user_id) };
  }

  const { rows: stale } = await query(
    'SELECT user_id, replaced_at FROM refresh_tokens WHERE token_hash = $1',
    [hash]
  );
  const replacedAt = stale[0]?.replaced_at;
  if (replacedAt && Date.now() - new Date(replacedAt).getTime() > REUSE_GRACE_MS) {
    console.warn(`[auth] refresh token reuse detected for user ${stale[0].user_id}; revoking all sessions`);
    await revokeAllSessions(stale[0].user_id);
  }
  return null;
}

export async function revokeRefreshToken(raw) {
  if (typeof raw !== 'string') return;
  await query(
    'UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL',
    [hashToken(raw)]
  );
}

/**
 * Ends every session the user has, everywhere, immediately: app refresh
 * tokens, outstanding access tokens (via session_version), and the MCP
 * client's OAuth tokens. Used by "Sign out everywhere", password reset and
 * refresh-token reuse detection.
 */
export async function revokeAllSessions(userId) {
  await query('UPDATE users SET session_version = session_version + 1 WHERE id = $1', [userId]);
  await query(
    'UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL',
    [userId]
  );
  await query('DELETE FROM oauth_access_tokens WHERE user_id = $1', [userId]);
  await query('DELETE FROM oauth_refresh_tokens WHERE user_id = $1', [userId]);
}
