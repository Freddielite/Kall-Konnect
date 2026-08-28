import crypto from 'node:crypto';
import { query } from '../db.js';

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/** Verifies a Bearer token issued by our own /oauth/token endpoint (the MCP
 * client flow) — distinct from the app's own JWT session tokens. */
export async function requireOAuthToken(req, res, next) {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing bearer token' });

  const { rows } = await query(
    'SELECT user_id, client_id, scope, expires_at FROM oauth_access_tokens WHERE token_hash = $1',
    [hashToken(token)]
  );
  const row = rows[0];
  if (!row || new Date(row.expires_at) < new Date()) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  req.userId = row.user_id;
  req.oauthClientId = row.client_id;
  req.oauthScope = row.scope;
  next();
}
