/**
 * Holds the session for browsers that refuse our cookies.
 *
 * Background: the frontend is on *.vercel.app and the API on
 * *.onrender.com. Both are on the Public Suffix List, so no COOKIE_DOMAIN
 * can make them same-site, which means the auth cookies are necessarily
 * SameSite=None third-party cookies. Safari blocks those outright, and on
 * iOS *every* browser is Safari underneath (WebKit is mandated), so no iOS
 * user could stay signed in: login returned 200, the cookie was dropped
 * without any error, and the next request 401'd. The app said "Welcome
 * back!" and then bounced straight back to the sign-in screen.
 *
 * The fix is to let the client carry the tokens itself and send them as an
 * Authorization header. That trades a little safety for working auth —
 * tokens in storage are readable by any XSS, where httpOnly cookies are
 * not — so it is deliberately a fallback, not the default:
 *
 *   - Cookies are still set and still preferred on every browser.
 *   - We only keep the tokens after *observing* that the cookies were
 *     dropped, which is a fact about this browser, not a guess about it.
 *   - The moment cookies are seen working, anything stored is discarded.
 *
 * The proper fix is a custom domain (app.example.com + api.example.com
 * with COOKIE_DOMAIN=.example.com), which makes the cookies first-party
 * and makes all of this dead code. See DEPLOYING.md.
 */

const STORAGE_KEY = 'kk.session.v1';

/** The non-httpOnly CSRF cookie, set alongside the auth cookies with the
 * same SameSite/Secure attributes. It is our probe: if the browser kept
 * this one, it kept the auth cookies too; if it is missing right after a
 * successful login, everything in that Set-Cookie batch was dropped. */
const CSRF_COOKIE = 'kk_csrf';

export interface IssuedTokens {
  accessToken?: string;
  refreshToken?: string;
  csrfToken?: string;
}

interface StoredSession {
  accessToken: string;
  refreshToken?: string;
  csrfToken?: string;
}

/** Safari in Private Browsing has historically thrown on localStorage
 * access rather than simply being empty. Falling back to memory keeps the
 * session alive for the tab instead of failing the login outright — the
 * user just has to sign in again next time they open the app. */
let memorySession: StoredSession | null = null;
let memoryOnly = false;

function readStored(): StoredSession | null {
  if (memoryOnly) return memorySession;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as StoredSession) : null;
  } catch {
    memoryOnly = true;
    return memorySession;
  }
}

function writeStored(session: StoredSession | null) {
  memorySession = session;
  if (memoryOnly) return;
  try {
    if (session) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    memoryOnly = true;
  }
}

/** True when the browser accepted the cookies the server just set. */
export function cookieSessionActive(): boolean {
  return document.cookie.split('; ').some((row) => row.startsWith(`${CSRF_COOKIE}=`));
}

/**
 * Called with the body of any response that issues a session. Decides,
 * per browser, whether we need to hold onto the tokens.
 *
 * Order matters: this runs immediately after the fetch resolves, at which
 * point the browser has already processed (or discarded) the Set-Cookie
 * headers from that same response, so cookieSessionActive() is answering
 * about this login rather than a previous one.
 */
export function adoptTokens(payload: unknown): void {
  const tokens = payload as IssuedTokens | null;
  if (!tokens?.accessToken) return;

  if (cookieSessionActive()) {
    // Cookies work here. Keep nothing: the httpOnly cookie is strictly
    // safer, and a stale stored token would otherwise shadow it.
    clearStoredSession();
    return;
  }

  writeStored({
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    csrfToken: tokens.csrfToken,
  });
}

export function getAccessToken(): string | undefined {
  return readStored()?.accessToken;
}

export function getRefreshToken(): string | undefined {
  return readStored()?.refreshToken;
}

export function getStoredCsrfToken(): string | undefined {
  return readStored()?.csrfToken;
}

/** Whether this browser is running on the header fallback rather than cookies. */
export function usingTokenFallback(): boolean {
  return Boolean(readStored()?.accessToken);
}

export function clearStoredSession(): void {
  writeStored(null);
}

/** Seconds until the stored access token expires; 0 if there is none or it
 * is unreadable. Only the `exp` claim is read — the signature is checked
 * server-side, this is purely to avoid firing a request we know will 401. */
export function accessTokenSecondsRemaining(): number {
  const token = getAccessToken();
  if (!token) return 0;
  try {
    const [, payload] = token.split('.');
    const claims = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
    if (typeof claims.exp !== 'number') return 0;
    return Math.max(0, claims.exp - Math.floor(Date.now() / 1000));
  } catch {
    return 0;
  }
}
