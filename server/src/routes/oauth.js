import { Router } from 'express';
import crypto from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import { query } from '../db.js';
import { env } from '../env.js';
import { requireAuth } from '../middleware/requireAuth.js';

export const oauthRouter = Router();

const secretKey = new TextEncoder().encode(env.jwtSecret);
const hashToken = (t) => crypto.createHash('sha256').update(t).digest('hex');
const randomToken = () => crypto.randomBytes(48).toString('base64url');

// ── Dynamic client registration (RFC 7591-ish, public clients only) ───────
// MCP clients call this once to get a client_id before starting the
// authorize/token dance. We don't issue client secrets — every client is
// treated as public and must use PKCE, which is what OAuth 2.1 recommends
// anyway for apps that can't keep a secret confidential.
oauthRouter.post('/oauth/register', async (req, res) => {
  const { redirect_uris, client_name } = req.body ?? {};
  if (!Array.isArray(redirect_uris) || redirect_uris.length === 0) {
    return res.status(400).json({ error: 'redirect_uris is required' });
  }
  const clientId = crypto.randomUUID();
  await query(
    'INSERT INTO oauth_clients (client_id, client_name, redirect_uris) VALUES ($1, $2, $3)',
    [clientId, client_name ?? 'Unnamed MCP client', redirect_uris]
  );
  res.status(201).json({
    client_id: clientId,
    client_name: client_name ?? 'Unnamed MCP client',
    redirect_uris,
    token_endpoint_auth_method: 'none',
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
  });
});

// ── /oauth/authorize ────────────────────────────────────────────────────
// Hit directly by the MCP client's browser redirect (top-level navigation),
// so there's no Authorization header available yet. We package the request
// into a short-lived signed token and bounce the browser to the frontend's
// consent screen, which *does* have the user's app session.
oauthRouter.get('/oauth/authorize', async (req, res) => {
  const { response_type, client_id, redirect_uri, scope, state, code_challenge, code_challenge_method } = req.query;

  if (response_type !== 'code') return res.status(400).send('Only response_type=code is supported');

  const { rows } = await query('SELECT redirect_uris FROM oauth_clients WHERE client_id = $1', [client_id]);
  const client = rows[0];
  if (!client) return res.status(400).send('Unknown client_id');
  if (!client.redirect_uris.includes(redirect_uri)) return res.status(400).send('redirect_uri not registered for this client');
  if (!code_challenge || code_challenge_method !== 'S256') {
    return res.status(400).send('PKCE (S256) is required');
  }

  const pending = await new SignJWT({
    client_id, redirect_uri, scope: scope ?? '', state: state ?? '',
    code_challenge, code_challenge_method,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(secretKey);

  res.redirect(`${env.appUrl}/oauth/consent?authorization_id=${encodeURIComponent(pending)}`);
});

// Frontend consent page calls this (authenticated) to find out what it's
// approving — decodes the pending token from /oauth/authorize and looks up
// the client's display name.
oauthRouter.get('/oauth/authorize/details', requireAuth, async (req, res) => {
  const { authorization_id } = req.query;
  try {
    const { payload } = await jwtVerify(authorization_id, secretKey);
    const { rows } = await query('SELECT client_name FROM oauth_clients WHERE client_id = $1', [payload.client_id]);
    res.json({ client: { name: rows[0]?.client_name ?? 'Unknown app' }, scope: payload.scope });
  } catch {
    res.status(400).json({ error: 'This authorization request is invalid or has expired.' });
  }
});

async function decide(req, res, approve) {
  const { authorization_id } = req.body ?? {};
  let payload;
  try {
    ({ payload } = await jwtVerify(authorization_id, secretKey));
  } catch {
    return res.status(400).json({ error: 'This authorization request is invalid or has expired.' });
  }

  const redirectUrl = new URL(payload.redirect_uri);
  if (!approve) {
    redirectUrl.searchParams.set('error', 'access_denied');
    if (payload.state) redirectUrl.searchParams.set('state', payload.state);
    return res.json({ redirect_url: redirectUrl.toString() });
  }

  const code = randomToken();
  await query(
    `INSERT INTO oauth_authorization_codes
       (code, client_id, user_id, redirect_uri, scope, code_challenge, code_challenge_method, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      code, payload.client_id, req.userId, payload.redirect_uri, payload.scope,
      payload.code_challenge, payload.code_challenge_method,
      new Date(Date.now() + env.oauthAuthCodeTtlSeconds * 1000),
    ]
  );

  redirectUrl.searchParams.set('code', code);
  if (payload.state) redirectUrl.searchParams.set('state', payload.state);
  res.json({ redirect_url: redirectUrl.toString() });
}

oauthRouter.post('/oauth/authorize/approve', requireAuth, (req, res) => decide(req, res, true));
oauthRouter.post('/oauth/authorize/deny', requireAuth, (req, res) => decide(req, res, false));

// ── /oauth/token ────────────────────────────────────────────────────────
oauthRouter.post('/oauth/token', async (req, res) => {
  const { grant_type } = req.body ?? {};

  if (grant_type === 'authorization_code') {
    const { code, redirect_uri, client_id, code_verifier } = req.body ?? {};
    const { rows } = await query('SELECT * FROM oauth_authorization_codes WHERE code = $1', [code]);
    const authCode = rows[0];

    if (!authCode || authCode.used || new Date(authCode.expires_at) < new Date()) {
      return res.status(400).json({ error: 'invalid_grant' });
    }
    if (authCode.client_id !== client_id || authCode.redirect_uri !== redirect_uri) {
      return res.status(400).json({ error: 'invalid_grant' });
    }

    const challenge = crypto.createHash('sha256').update(code_verifier ?? '').digest('base64url');
    if (challenge !== authCode.code_challenge) {
      return res.status(400).json({ error: 'invalid_grant', error_description: 'PKCE verification failed' });
    }

    await query('UPDATE oauth_authorization_codes SET used = true WHERE code = $1', [code]);
    return res.json(await issueOAuthTokenPair(authCode.client_id, authCode.user_id, authCode.scope));
  }

  if (grant_type === 'refresh_token') {
    const { refresh_token, client_id } = req.body ?? {};
    const { rows } = await query('SELECT * FROM oauth_refresh_tokens WHERE token_hash = $1', [hashToken(refresh_token ?? '')]);
    const stored = rows[0];
    if (!stored || stored.revoked || stored.client_id !== client_id || new Date(stored.expires_at) < new Date()) {
      return res.status(400).json({ error: 'invalid_grant' });
    }
    await query('UPDATE oauth_refresh_tokens SET revoked = true WHERE token_hash = $1', [stored.token_hash]);
    return res.json(await issueOAuthTokenPair(stored.client_id, stored.user_id, stored.scope));
  }

  res.status(400).json({ error: 'unsupported_grant_type' });
});

async function issueOAuthTokenPair(clientId, userId, scope) {
  const accessToken = randomToken();
  const refreshToken = randomToken();
  await query(
    'INSERT INTO oauth_access_tokens (token_hash, client_id, user_id, scope, expires_at) VALUES ($1,$2,$3,$4,$5)',
    [hashToken(accessToken), clientId, userId, scope, new Date(Date.now() + env.oauthAccessTokenTtlSeconds * 1000)]
  );
  await query(
    'INSERT INTO oauth_refresh_tokens (token_hash, client_id, user_id, scope, expires_at) VALUES ($1,$2,$3,$4,$5)',
    [hashToken(refreshToken), clientId, userId, scope, new Date(Date.now() + env.oauthRefreshTokenTtlDays * 86_400_000)]
  );
  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    token_type: 'Bearer',
    expires_in: env.oauthAccessTokenTtlSeconds,
    scope,
  };
}
