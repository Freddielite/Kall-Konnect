import crypto from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import { env } from '../env.js';
import { query } from '../db.js';

const secretKey = new TextEncoder().encode(env.jwtSecret);

export async function signAccessToken(userId) {
  return new SignJWT({ sub: userId })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${env.accessTokenTtlSeconds}s`)
    .sign(secretKey);
}

/** Returns the userId, or null if the token is missing/invalid/expired. */
export async function verifyAccessToken(token) {
  try {
    const { payload } = await jwtVerify(token, secretKey);
    return payload.sub ?? null;
  } catch {
    return null;
  }
}

function hashToken(token) {
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

/** Validates a refresh token, rotates it (revokes old, issues new), returns { userId, refreshToken } or null. */
export async function rotateRefreshToken(raw) {
  const hash = hashToken(raw);
  const { rows } = await query(
    `SELECT id, user_id, expires_at, revoked_at FROM refresh_tokens WHERE token_hash = $1`,
    [hash]
  );
  const row = rows[0];
  if (!row || row.revoked_at || new Date(row.expires_at) < new Date()) return null;

  await query('UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1', [row.id]);
  const newToken = await issueRefreshToken(row.user_id);
  return { userId: row.user_id, refreshToken: newToken };
}

export async function revokeRefreshToken(raw) {
  await query('UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = $1', [hashToken(raw)]);
}
