import { ACCESS_COOKIE, REFRESH_COOKIE } from './cookies.js';

/**
 * Reads session credentials from a request, from either transport.
 *
 * The cookie transport is still the default and still preferred. But the
 * frontend and API are on unrelated registrable domains (*.vercel.app and
 * *.onrender.com are both on the Public Suffix List, so no COOKIE_DOMAIN
 * can bridge them), which makes the auth cookies third-party. Safari on
 * iOS/iPadOS — and therefore every browser on iOS, since they all use
 * WebKit — blocks third-party cookies outright with no way for the site to
 * opt out. Login returned 200, the Set-Cookie was silently dropped, and
 * the very next request 401'd, so the app said "Welcome back!" and then
 * bounced straight back to the sign-in screen.
 *
 * So the client is allowed to carry the same tokens itself and present
 * them as `Authorization: Bearer <access token>` instead. It only does
 * that when it can prove cookies were dropped (see src/lib/session-store.ts),
 * so browsers where cookies work are entirely unaffected.
 */

/** `Authorization: Bearer <token>`, or undefined. */
export function bearerToken(req) {
  const header = req.headers?.authorization;
  if (typeof header !== 'string') return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : undefined;
}

/**
 * The access token plus which transport carried it. The transport matters:
 * cookies are attached by the browser on any cross-site request, so they
 * need the CSRF double-submit check. An Authorization header can only be
 * set by JS that this origin's CORS policy already allows, so it is not
 * forgeable cross-site and needs no CSRF token.
 */
export function readAccessToken(req) {
  const bearer = bearerToken(req);
  if (bearer) return { token: bearer, transport: 'bearer' };

  const cookie = req.cookies?.[ACCESS_COOKIE];
  if (cookie) return { token: cookie, transport: 'cookie' };

  return { token: undefined, transport: 'none' };
}

/**
 * The refresh token, from the cookie where cookies work and from the
 * request body otherwise. Body rather than a header because /auth/refresh
 * is a POST the client makes deliberately; there is no third transport to
 * confuse it with.
 */
export function readRefreshToken(req) {
  return req.cookies?.[REFRESH_COOKIE] ?? req.body?.refreshToken ?? undefined;
}
