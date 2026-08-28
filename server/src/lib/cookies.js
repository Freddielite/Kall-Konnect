import crypto from 'node:crypto';
import { env } from '../env.js';

export const ACCESS_COOKIE = 'kk_at';
export const REFRESH_COOKIE = 'kk_rt';
export const CSRF_COOKIE = 'kk_csrf';

/**
 * Works out the right SameSite policy for this deployment.
 *
 * The frontend and API are separate origins. Whether that counts as
 * "cross-site" (and therefore whether Lax cookies get dropped) depends on
 * registrable domain, not origin:
 *
 *   - app.wyntek.tech  → api.wyntek.tech    same site. Lax works, and is
 *     safer: the browser withholds the cookie on cross-site requests, which
 *     is CSRF defence in depth on top of the double-submit token.
 *   - kk.vercel.app    → kk.onrender.com    cross-site. Lax cookies are
 *     never sent on the API's XHR calls, so login silently does nothing.
 *     Requires SameSite=None, which requires Secure.
 *
 * Note that vercel.app and onrender.com are both on the Public Suffix List,
 * so COOKIE_DOMAIN cannot bridge them — a custom domain is the only way to
 * get back to Lax.
 */
function resolveSameSite() {
  if (env.cookieSameSite) return env.cookieSameSite.toLowerCase(); // explicit override
  // A shared parent domain means same-site, so Lax is both correct and safer.
  if (env.cookieDomain) return 'lax';
  // HTTPS with no shared parent domain — assume split hosting (Vercel + Render).
  if (env.cookieSecure) return 'none';
  // Plain-http local/LAN dev, single origin pair.
  return 'lax';
}

export const SAME_SITE = resolveSameSite();

// SameSite=None without Secure is rejected outright by every current
// browser — the cookie is dropped and auth fails with no console error.
// Force the pairing rather than shipping a silently broken login.
const COOKIE_SECURE = SAME_SITE === 'none' ? true : env.cookieSecure;

/** Warnings for the startup preflight in index.js. */
export function checkCookieConfig() {
  const problems = [];
  if (SAME_SITE === 'none' && !env.cookieSecure) {
    problems.push({
      fatal: false,
      message:
        'SameSite=None requires Secure, so Secure has been forced on. Cookies will NOT work over plain http.',
      fix: 'Set COOKIE_SECURE=true (you are on HTTPS in production), or COOKIE_SAMESITE=lax for local dev.',
    });
  }
  if (SAME_SITE === 'none') {
    problems.push({
      fatal: false,
      message:
        'Auth cookies are SameSite=None (split hosting). Browsers treat these as THIRD-PARTY ' +
        'cookies: Brave and Safari block them by default, and Chrome is phasing them out. ' +
        'Where they are blocked, login returns 200, the cookie is silently dropped, and the ' +
        'next request 401s — so the app appears to sign in and immediately sign out. The ' +
        'WebSocket fails the same way, since it reads the same cookie on the upgrade request. ' +
        'No server setting can override this; it is browser policy. ' +
        'The double-submit CSRF token is also your only CSRF defence under None.',
      fix:
        'Put the frontend and API on subdomains of one domain you own (app.example.com + ' +
        'api.example.com) and set COOKIE_DOMAIN=.example.com — that makes them same-site, so ' +
        'SameSite=Lax applies and nothing blocks them. Note *.vercel.app and *.onrender.com ' +
        'are on the Public Suffix List, so COOKIE_DOMAIN cannot bridge those; a custom domain ' +
        'is the only route. Until then expect login to fail in Brave and Safari.',
    });
  }
  if (env.isProduction && !env.cookieSecure && SAME_SITE !== 'none') {
    problems.push({
      fatal: true,
      message: 'Running in production with COOKIE_SECURE=false — auth cookies will be sent over plain http.',
      fix: 'Set COOKIE_SECURE=true.',
    });
  }
  return problems;
}

function baseOpts() {
  return {
    httpOnly: true,
    secure: COOKIE_SECURE,
    sameSite: SAME_SITE,
    domain: env.cookieDomain,
    path: '/',
  };
}

/** Sets the access + refresh token cookies after login/register/refresh. */
export function setAuthCookies(res, { accessToken, refreshToken }) {
  res.cookie(ACCESS_COOKIE, accessToken, {
    ...baseOpts(),
    maxAge: env.accessTokenTtlSeconds * 1000,
  });
  res.cookie(REFRESH_COOKIE, refreshToken, {
    ...baseOpts(),
    // Scoped to /auth so it's only ever sent to the refresh/logout
    // endpoints, not on every request — it's the longer-lived credential.
    path: '/auth',
    maxAge: env.refreshTokenTtlDays * 86_400_000,
  });
}

/** Non-httpOnly so the frontend can read it and echo it back as a header
 * (double-submit CSRF pattern) — this cookie carries no auth power on its
 * own, it just proves the request came from a page that can read the DOM
 * for this origin, which cross-site form/script attacks can't do. */
export function setCsrfCookie(res) {
  const token = crypto.randomBytes(24).toString('base64url');
  res.cookie(CSRF_COOKIE, token, {
    httpOnly: false,
    secure: COOKIE_SECURE,
    sameSite: SAME_SITE,
    domain: env.cookieDomain,
    path: '/',
    maxAge: env.refreshTokenTtlDays * 86_400_000,
  });
  return token;
}

export function clearAuthCookies(res) {
  res.clearCookie(ACCESS_COOKIE, { ...baseOpts() });
  res.clearCookie(REFRESH_COOKIE, { ...baseOpts(), path: '/auth' });
  res.clearCookie(CSRF_COOKIE, { ...baseOpts() });
}
