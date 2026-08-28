import { verifyAccessToken } from '../lib/tokens.js';
import { ACCESS_COOKIE, CSRF_COOKIE } from '../lib/cookies.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Requires a valid `kk_at` session cookie and sets req.userId. This is the
 * app-level replacement for Supabase RLS's `auth.uid()` — every route
 * handler below is responsible for filtering its own queries by
 * req.userId. There is no database-level safety net here.
 *
 * Since the session now lives in an httpOnly cookie (sent automatically by
 * the browser on every request, not just ones the page's own JS makes),
 * mutating requests also require a matching X-CSRF-Token header against
 * the non-httpOnly kk_csrf cookie (double-submit pattern) — a cross-site
 * page can trigger the cookie to be sent, but can't read kk_csrf to put it
 * in the header, since that requires same-origin JS access.
 */
export async function requireAuth(req, res, next) {
  const token = req.cookies?.[ACCESS_COOKIE];
  if (!token) return res.status(401).json({ error: 'Not signed in' });

  const userId = await verifyAccessToken(token);
  if (!userId) return res.status(401).json({ error: 'Invalid or expired session' });

  if (!SAFE_METHODS.has(req.method)) {
    const csrfCookie = req.cookies?.[CSRF_COOKIE];
    const csrfHeader = req.headers['x-csrf-token'];
    if (!csrfCookie || !csrfHeader || csrfCookie !== csrfHeader) {
      return res.status(403).json({ error: 'Missing or invalid CSRF token' });
    }
  }

  req.userId = userId;
  next();
}
