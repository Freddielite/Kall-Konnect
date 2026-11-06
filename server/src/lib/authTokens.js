import crypto from 'node:crypto';
import { query } from '../db.js';

const TTL_MS = {
  password_reset: 60 * 60 * 1000, // 1 hour
  email_verification: 24 * 60 * 60 * 1000, // 24 hours
};

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/** Issues a one-time token for the given purpose, returns the raw token. */
export async function issueAuthToken(userId, purpose) {
  const raw = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + TTL_MS[purpose]);
  await query(
    `INSERT INTO auth_tokens (user_id, token_hash, purpose, expires_at) VALUES ($1, $2, $3, $4)`,
    [userId, hashToken(raw), purpose, expiresAt]
  );
  return raw;
}

/**
 * Validates and consumes a one-time token in a single statement, so two
 * simultaneous clicks on the same reset link can't both succeed. Returns
 * the userId, or null if missing/expired/already used/wrong purpose.
 */
export async function consumeAuthToken(raw, purpose) {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 200) return null;
  const { rows } = await query(
    `UPDATE auth_tokens SET used_at = now()
      WHERE token_hash = $1 AND purpose = $2 AND used_at IS NULL AND expires_at > now()
      RETURNING user_id`,
    [hashToken(raw), purpose]
  );
  return rows[0]?.user_id ?? null;
}

/** Invalidates every unused token of a purpose for a user, e.g. all
 * outstanding reset links once the password has been changed. */
export async function invalidateAuthTokens(userId, purpose) {
  await query(
    'UPDATE auth_tokens SET used_at = now() WHERE user_id = $1 AND purpose = $2 AND used_at IS NULL',
    [userId, purpose]
  );
}
