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
 * Validates and consumes a one-time token. Returns the userId on success,
 * or null if it's missing/expired/already used/wrong purpose. Consuming
 * marks it used so it can't be replayed.
 */
export async function consumeAuthToken(raw, purpose) {
  if (!raw) return null;
  const hash = hashToken(raw);
  const { rows } = await query(
    `SELECT id, user_id, expires_at, used_at FROM auth_tokens WHERE token_hash = $1 AND purpose = $2`,
    [hash, purpose]
  );
  const row = rows[0];
  if (!row || row.used_at || new Date(row.expires_at) < new Date()) return null;

  await query('UPDATE auth_tokens SET used_at = now() WHERE id = $1', [row.id]);
  return row.user_id;
}
