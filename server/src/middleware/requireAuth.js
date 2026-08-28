import { verifyAccessToken } from '../lib/tokens.js';
import { CSRF_COOKIE } from '../lib/cookies.js';
import { readAccessToken } from '../lib/session.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Requires a valid session and sets req.userId. This is the app-level
 * replacement for Supabase RLS's `auth.uid()` — every route handler below
 * is responsible for filtering its own queries by req.userId. There is no
 * database-level safety net here.
 *
 * Two transports are accepted, in this order:
 *
 *   1. `Authorization: Bearer <access token>` — used only by clients whose
 *      browser dropped our cookies (iOS/Safari third-party cookie
 *      blocking; see lib/session.js). No CSRF token is required with this
 *      transport, because a header is not something a cross-site page can
 *      make the browser attach: it must be set by JS, and CORS decides
 *      whether that JS may talk to us at all. The CSRF check exists
 *      precisely because cookies do *not* have that property.
 *
 *   2. The `kk_at` cookie — the default everywhere else. Because the
 *      browser attaches it to any request to this origin, including ones
 *      a cross-site page triggered, mutating requests must also carry a
 *      matching X-CSRF-Token header echoing the non-httpOnly `kk_csrf`
 *      cookie (double-submit). A cross-site page can cause the cookie to
 *      be sent but cannot read it to build the header.
 */
export async function requireAuth(req, res, next) {
  const { token, transport } = readAccessToken(req);
  if (!token) return res.status(401).json({ error: 'Not signed in' });

  const userId = await verifyAccessToken(token);
  if (!userId) return res.status(401).json({ error: 'Invalid or expired session' });

  if (transport === 'cookie' && !SAFE_METHODS.has(req.method)) {
    const csrfCookie = req.cookies?.[CSRF_COOKIE];
    const csrfHeader = req.headers['x-csrf-token'];
    if (!csrfCookie || !csrfHeader || csrfCookie !== csrfHeader) {
      return res.status(403).json({ error: 'Missing or invalid CSRF token' });
    }
  }

  req.userId = userId;
  next();
}
