import {
  adoptTokens,
  getAccessToken,
  getRefreshToken,
  getStoredCsrfToken,
  clearStoredSession,
  usingTokenFallback,
  accessTokenSecondsRemaining,
} from './session-store';

const DEFAULT_BACKEND_PORT = '4000';

/** Bare IPv4 literal, e.g. 192.168.1.162. */
function isIpLiteral(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
}

/** A host that only means anything on this machine or this LAN — as
 * opposed to a real domain (kk.onrender.com) that means the same thing
 * everywhere. Only these are safe to rewrite. */
function isLocalHost(host: string): boolean {
  if (host === 'localhost' || host.endsWith('.local')) return true;
  if (!isIpLiteral(host)) return false;
  return /^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host);
}

/**
 * Works out which address to send API calls to.
 *
 * `VITE_API_URL` is inlined by Vite at dev-server *start*, not at page
 * load. So when DHCP moves this machine to a new address, a dev server
 * that was already running keeps serving the old one, and every request
 * goes to an address nothing answers on — which looks exactly like a
 * broken app rather than a stale process. Restarting Vite fixes it, but
 * only if you know that's what's wrong.
 *
 * The browser already knows the right answer: it reached this page
 * somehow, and the backend sits on the same machine. So when the
 * configured host is a LAN/localhost address that disagrees with the host
 * the page was actually loaded from, trust the browser and rewrite it.
 * Real domains are never touched, so production is unaffected, and
 * VITE_API_URL_EXACT=true opts out entirely for the split-machine case
 * (frontend on one device, backend on another).
 */
export function resolveApiUrl(
  configured: string | undefined,
  loc: { protocol: string; hostname: string },
  exact = false
): string {
  const trimmed = configured?.trim().replace(/\/+$/, '');

  // Nothing configured: the backend is on whichever host served this page.
  if (!trimmed) return `${loc.protocol}//${loc.hostname}:${DEFAULT_BACKEND_PORT}`;
  if (exact) return trimmed;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return trimmed; // not parseable — leave it alone rather than guess
  }

  const bothLocal = isLocalHost(url.hostname) && isLocalHost(loc.hostname);
  if (bothLocal && url.hostname !== loc.hostname) {
    const corrected = `${url.protocol}//${loc.hostname}:${url.port || DEFAULT_BACKEND_PORT}`;
    if (import.meta.env.DEV) {
      console.warn(
        `[api] VITE_API_URL points at ${url.hostname}, but this page was loaded from ` +
          `${loc.hostname}. Using ${corrected} instead.\n` +
          '[api] This usually means the LAN IP changed while the dev server was running — ' +
          'restart it (npm run dev) to re-sync .env and silence this warning.'
      );
    }
    return corrected;
  }

  return trimmed;
}

// Nothing else here bounds how long a request can take, so a backend
// that's unreachable or silently rejecting (wrong CORS_ORIGIN, DB
// hiccup, etc) would otherwise hang forever - which is especially bad
// for /auth/me, since App.tsx's splash screen waits on it and has no
// fallback if it never settles.
//
// The floor is the backend's own DB pool timeout of 5s
// (connectionTimeoutMillis in server/src/db.js): below that, the client
// gives up before the server can return a real error, replacing "Could
// not sign in" with a generic timeout and hiding the actual cause.
//
// The ceiling depends on where the backend is. On a LAN, 15s is already
// generous. But free tiers on Render/Fly/Heroku spin idle instances down
// and take 30-60s to wake, so the first request after a quiet period is
// slow for a legitimate reason - timing it out would make a working
// deployment look broken. Remote hosts therefore get a longer default,
// overridable either way with VITE_REQUEST_TIMEOUT_MS.
const LOCAL_TIMEOUT_MS = 15_000;
const REMOTE_TIMEOUT_MS = 60_000;

const API_URL = resolveApiUrl(
  import.meta.env.VITE_API_URL,
  window.location,
  import.meta.env.VITE_API_URL_EXACT === 'true'
);

/** Whether the resolved backend is on this machine/LAN, which decides the
 * default timeout above. Parsed from the final URL rather than the
 * configured one, so it follows any correction resolveApiUrl made. */
function apiIsLocal(): boolean {
  try {
    return isLocalHost(new URL(API_URL).hostname);
  } catch {
    return true; // unparseable — assume local and keep the tighter bound
  }
}

const REQUEST_TIMEOUT_MS =
  Number(import.meta.env.VITE_REQUEST_TIMEOUT_MS) ||
  (apiIsLocal() ? LOCAL_TIMEOUT_MS : REMOTE_TIMEOUT_MS);

// A production bundle with no VITE_API_URL falls back to the page's own
// host on port 4000, which is never right once deployed - the API is on a
// different host, and nothing serves 4000 from the CDN. Vite inlines env
// vars at build time, so this cannot be corrected at runtime: the bundle
// has to be rebuilt with the variable set. Say so plainly rather than
// letting every request fail with a connection error.
if (import.meta.env.PROD && !import.meta.env.VITE_API_URL) {
  console.error(
    `[api] VITE_API_URL was not set at build time, so API calls are going to ${API_URL}, ` +
      'which is almost certainly wrong.\n' +
      '[api] Set VITE_API_URL (and VITE_WS_URL) in your hosting dashboard and redeploy — ' +
      'Vite inlines these during the build, so a redeploy is required.'
  );
}

// Same staleness applies to VITE_WS_URL, so run it through the same
// resolver. URL() understands ws:// but isLocalHost only cares about the
// hostname, so swapping the scheme either way is safe.
export const WS_URL = import.meta.env.VITE_WS_URL
  ? resolveApiUrl(
      import.meta.env.VITE_WS_URL.trim().replace(/^ws/, 'http'),
      window.location,
      import.meta.env.VITE_API_URL_EXACT === 'true'
    ).replace(/^http/, 'ws')
  : API_URL.replace(/^http/, 'ws');


/** The server answered, but with a non-2xx status. `message` is the
 * server's own `error` field where it sent one, so these are safe to show
 * to the user directly. */
export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'ApiError';
  }
}

/** The server never answered at all - wrong address, not running,
 * blocked by a firewall, or too slow. Distinct from ApiError because the
 * fix is completely different: nothing is wrong with the request, the
 * backend just isn't there. */
export class NetworkError extends Error {
  /** The original DOMException/TypeError, kept for debugging. Assigned
   * directly rather than via `super(message, { cause })` because this
   * project targets ES2020, which predates the Error `cause` option. */
  readonly cause?: unknown;

  constructor(
    message: string,
    readonly kind: 'timeout' | 'unreachable',
    readonly url: string,
    options?: { cause?: unknown }
  ) {
    super(message);
    this.name = 'NetworkError';
    this.cause = options?.cause;
  }
}

/** fetch() rejects with a bare DOMException when an AbortController fires,
 * whose message ("signal is aborted without reason") is meaningless to a
 * user and actively misleading to a developer - it describes the mechanism
 * that cancelled the request, not why the request needed cancelling. Every
 * failure mode below is translated into something that names the address
 * we actually tried and what to check. */
async function fetchWithTimeout(input: string, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, REQUEST_TIMEOUT_MS);

  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (err) {
    const seconds = Math.round(REQUEST_TIMEOUT_MS / 1000);

    if (timedOut) {
      // A TCP connection that is never accepted and never refused - the
      // usual signature of an address nothing is listening on, with a
      // firewall dropping the packets instead of sending a reset.
      logConnectionHint(
        `No response from ${API_URL} within ${seconds}s.`,
        'The address is reachable-looking but nothing answered. Either the backend is not running, ' +
          'or VITE_API_URL points at an interface this device cannot reach (a virtual/host-only ' +
          'adapter, or a stale DHCP address). Open ' + API_URL + '/health directly in this browser: ' +
          'if that also hangs, the address is wrong, not the app.'
      );
      throw new NetworkError(
        `The server at ${API_URL} didn't respond within ${seconds}s. Check that the backend is running and reachable from this device.`,
        'timeout',
        input,
        { cause: err }
      );
    }

    // fetch() rejects with a TypeError for DNS failure, connection
    // refused, and blocked-by-CORS alike - the spec deliberately refuses
    // to tell JS which, so the browser devtools Network tab is the only
    // way to tell them apart.
    logConnectionHint(
      `Could not reach ${API_URL}.`,
      'This is either connection-refused (backend not running) or a CORS rejection. Check the ' +
        "Network tab: a red 'CORS error' means this origin (" + window.location.origin + ') is ' +
        "missing from CORS_ORIGIN in server/.env; 'ERR_CONNECTION_REFUSED' means the backend is down."
    );
    throw new NetworkError(
      `Can't reach the server at ${API_URL}. Check that the backend is running.`,
      'unreachable',
      input,
      { cause: err }
    );
  } finally {
    clearTimeout(timer);
  }
}

/** The toast has room for one sentence; the developer needs a paragraph.
 * Split the difference - short message to the user, full diagnosis to the
 * console, dev builds only. */
function logConnectionHint(headline: string, detail: string) {
  if (import.meta.env.DEV) {
    console.error(`[api] ${headline}\n[api] ${detail}`);
  }
}

/** Auth normally lives in httpOnly cookies the browser manages
 * automatically. CSRF protection uses the double-submit pattern: the
 * server also sets a non-httpOnly `kk_csrf` cookie, which we read here and
 * echo back as a header on any state-changing request (the point isn't
 * secrecy, it's proving the request came from JS that can read this
 * origin's cookies, which a cross-site page can't do).
 *
 * Where the browser refuses those cookies — iOS/Safari blocks
 * third-party cookies, and our frontend and API are unavoidably on
 * different sites — we fall back to sending the same tokens as an
 * Authorization header instead. See session-store.ts for how that mode is
 * detected and why it is a fallback rather than the default. */
function readCsrfCookie(): string | undefined {
  return document.cookie
    .split('; ')
    .find((row) => row.startsWith('kk_csrf='))
    ?.split('=')[1];
}

/** Headers carrying whichever credential this browser can actually use.
 * In cookie mode this adds only the CSRF header and the cookie rides along
 * via credentials:'include'; in fallback mode it adds the bearer token
 * (which the server accepts without a CSRF token, since a header can't be
 * forged cross-site the way a cookie can). */
function authHeaders(method: string): Record<string, string> {
  const headers: Record<string, string> = {};

  const accessToken = getAccessToken();
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  if (MUTATING.has(method)) {
    const csrf = readCsrfCookie() ?? getStoredCsrfToken();
    if (csrf) headers['X-CSRF-Token'] = csrf;
  }

  return headers;
}

let refreshInFlight: Promise<boolean> | null = null;

/** Resolves false rather than throwing on any failure. A refresh attempt
 * is speculative - it happens in response to a 401 the caller has not
 * seen yet - so a network failure here must not replace the caller's
 * real error with a confusing one from a request they never made. */
async function refreshSession(): Promise<boolean> {
  try {
    // In cookie mode the refresh token rides in the (path-scoped) cookie
    // and the body is empty. In fallback mode we hold it ourselves and
    // must send it explicitly — and must store the rotated one that comes
    // back, or the next refresh fails and the user is logged out.
    const storedRefresh = getRefreshToken();
    const res = await fetchWithTimeout(`${API_URL}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(storedRefresh ? { refreshToken: storedRefresh } : {}),
    });

    if (!res.ok) {
      // A refresh token the server has rejected will never work again;
      // holding it would make every later request pay for two failed
      // round trips before giving up.
      if (res.status === 401) clearStoredSession();
      return false;
    }

    adoptTokens(await res.json().catch(() => null));
    return true;
  } catch {
    return false;
  }
}

/** Refreshes if the stored access token is spent, for the one caller that
 * can't retry on a 401: the WebSocket, which authenticates during the
 * upgrade handshake and just gets its connection closed. A minute of slack
 * covers the round trip and any clock skew. No-op in cookie mode, where
 * the browser and server handle expiry between themselves. */
export async function ensureFreshAccessToken(): Promise<void> {
  if (!usingTokenFallback()) return;
  if (accessTokenSecondsRemaining() > 60) return;
  refreshInFlight ??= refreshSession().finally(() => { refreshInFlight = null; });
  await refreshInFlight;
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  /** Skip the silent-refresh-and-retry-once behavior — used for the auth
   * endpoints themselves, where a 401 means "wrong password", not "token
   * expired, go refresh". */
  auth?: boolean;
}

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

async function request<T>(path: string, { method = 'GET', body, auth = true }: RequestOptions = {}): Promise<T> {
  const doFetch = () =>
    fetchWithTimeout(`${API_URL}${path}`, {
      method,
      credentials: 'include',
      // Rebuilt on every attempt, not captured once: a retry after a
      // refresh must use the *new* access token, not the expired one that
      // caused the 401.
      headers: { 'Content-Type': 'application/json', ...authHeaders(method) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

  let res = await doFetch();

  if (auth && res.status === 401) {
    refreshInFlight ??= refreshSession().finally(() => { refreshInFlight = null; });
    const refreshed = await refreshInFlight;
    if (refreshed) res = await doFetch();
  }

  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const data = await res.json();
      message = data.error ?? message;
    } catch {
      // ignore — not JSON
    }
    throw new ApiError(message, res.status);
  }

  // 204 carries no body, and some proxies strip bodies from 304s. Calling
  // res.json() on an empty body throws a SyntaxError that would surface as
  // "Unexpected end of JSON input" - another mechanism-level message that
  // tells the user nothing.
  if (res.status === 204 || res.headers.get('content-length') === '0') {
    return undefined as T;
  }

  const data = await res.json();
  // Login/register/social-sign-in/refresh all return the session tokens
  // alongside setting the cookies. adoptTokens keeps them only if this
  // browser dropped the cookies, so on Chrome/Firefox/Android this is a
  // single boolean check and nothing is stored.
  adoptTokens(data);
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown, opts?: RequestOptions) => request<T>(path, { method: 'POST', body, ...opts }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body }),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PUT', body }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};

export { API_URL };
