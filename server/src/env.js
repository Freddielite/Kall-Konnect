import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

// Load server/.env explicitly rather than relying on `dotenv/config`, which
// resolves relative to process.cwd(). Starting the server from the repo root
// (`node server/src/index.js`) used to silently load the root .env — which is
// Vite-only and has no SENDGRID_API_KEY — so email quietly fell back to
// dev/console mode with no indication anything was wrong.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

/** Env values routinely pick up stray whitespace when pasted (a trailing
 * space, or a newline from a wrapped API key). Those survive dotenv and then
 * break Bearer headers in ways that look like "the key is wrong". */
function clean(value) {
  return typeof value === 'string' ? value.trim() : value;
}

function required(name, fallback) {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

const isProduction = process.env.NODE_ENV === 'production';

export const env = {
  isProduction,
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: required('DATABASE_URL'),
  // Comma-separated list of allowed frontend origins. Defaults cover both
  // this project's actual dev port (vite.config.ts sets port: 8080) and
  // Vite's usual default (5173), so it works out of the box either way.
  corsOrigins: (process.env.CORS_ORIGIN ?? 'http://localhost:8080,http://localhost:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  // App session tokens (email/password, Google, Apple all end up minting these)
  jwtSecret: required('JWT_SECRET'),
  accessTokenTtlSeconds: Number(process.env.ACCESS_TOKEN_TTL_SECONDS ?? 15 * 60), // 15 min
  refreshTokenTtlDays: Number(process.env.REFRESH_TOKEN_TTL_DAYS ?? 30),

  // Google Sign-In (Google Identity Services on the frontend posts an id_token here)
  googleClientId: process.env.GOOGLE_CLIENT_ID ?? '',

  // Google Calendar (separate opt-in OAuth grant, distinct from Sign-In above —
  // Sign-In only ever proves identity, this actually authorizes writing events).
  // Client secret comes from the SAME OAuth Client ID in Google Cloud Console
  // as GOOGLE_CLIENT_ID — click into it, the secret is right there.
  googleClientSecret: clean(process.env.GOOGLE_CLIENT_SECRET) ?? '',
  // Where Google redirects after consent. MUST be added verbatim under that
  // same OAuth Client ID's "Authorized redirect URIs" in Google Cloud Console
  // (this is the one field the Sign-In setup told you to leave empty — that
  // was for Sign-In's token flow; this is the separate code flow, which
  // needs it). Points at the BACKEND, not the frontend.
  googleCalendarRedirectUri:
    process.env.GOOGLE_CALENDAR_REDIRECT_URI ?? 'http://localhost:4000/google-calendar/callback',

  // Sign in with Apple
  appleClientId: process.env.APPLE_CLIENT_ID ?? '', // your Services ID, e.g. com.wyntek.kallkonnect.web

  // MCP OAuth authorization server
  oauthAuthCodeTtlSeconds: Number(process.env.OAUTH_AUTH_CODE_TTL_SECONDS ?? 5 * 60),
  oauthAccessTokenTtlSeconds: Number(process.env.OAUTH_ACCESS_TOKEN_TTL_SECONDS ?? 60 * 60),
  oauthRefreshTokenTtlDays: Number(process.env.OAUTH_REFRESH_TOKEN_TTL_DAYS ?? 90),
  // Where the frontend's consent screen lives, so /oauth/authorize can redirect a
  // logged-in browser there to ask the user to approve/deny.
  appUrl: process.env.APP_URL ?? 'http://localhost:5173',

  // Web Push (real push notifications, delivered even when no tab is
  // open). Generate a keypair with: npx web-push generate-vapid-keys
  vapidPublicKey: process.env.VAPID_PUBLIC_KEY ?? '',
  vapidPrivateKey: process.env.VAPID_PRIVATE_KEY ?? '',
  // Contact address/URL Web Push services can use to reach you about this
  // key pair, e.g. 'mailto:you@example.com'. Required by the spec if the
  // keys are set at all.
  vapidSubject: process.env.VAPID_SUBJECT ?? 'mailto:admin@example.com',

  // SendGrid (transactional email: password reset, email verification,
  // calendar-reminder invites). Free tier: 100 emails/day, no domain
  // needed — just verify one sender email at
  // https://app.sendgrid.com/settings/sender_auth/senders (Settings >
  // Sender Authentication > Single Sender Verification). EMAIL_FROM below
  // MUST exactly match that verified address, or sends will fail.
  // Leave SENDGRID_API_KEY unset in dev and these features log the email
  // content to the console instead of sending, so nothing blocks on it.
  // The API key MUST have the "Mail Send" scope. A Restricted Access key
  // created without it authenticates fine and then 403s every single send —
  // the most common cause of "my key is correct but nothing arrives".
  sendgridApiKey: clean(process.env.SENDGRID_API_KEY) ?? '',
  emailFrom: clean(process.env.EMAIL_FROM) ?? 'Kall Konnect <you@example.com>',

  // Auth cookies. Secure requires HTTPS — leave false for LAN/http dev,
  // set true in production (COOKIE_SECURE=true).
  cookieSecure: (process.env.COOKIE_SECURE ?? 'false') === 'true',
  // Optional explicit cookie domain (e.g. '.wyntek.tech') for prod behind
  // a real domain. Leave unset for localhost/LAN-IP dev — the browser
  // scopes the cookie to the exact host automatically.
  cookieDomain: process.env.COOKIE_DOMAIN || undefined,
  // SameSite policy for auth cookies. Resolved in lib/cookies.js rather
  // than here, because the right default depends on cookieDomain and
  // cookieSecure together. Set COOKIE_SAMESITE explicitly to override.
  cookieSameSite: clean(process.env.COOKIE_SAMESITE) || undefined,

  // How many reverse proxies sit in front of this server. Render, Fly,
  // Heroku and friends all put exactly one. This MUST be set behind a
  // proxy or express sees the proxy's IP as req.ip for every request —
  // which silently collapses all users into a single rate-limit bucket,
  // so the 6th password-reset request from ANY user in an hour gets a 429
  // and no email. Auto-detected on Render; set TRUST_PROXY otherwise.
  trustProxy: (() => {
    const raw = clean(process.env.TRUST_PROXY);
    if (raw === undefined || raw === '') {
      // Render sets RENDER=true in every service container.
      return process.env.RENDER || isProduction ? 1 : false;
    }
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    const n = Number(raw);
    return Number.isFinite(n) ? n : raw; // also allows a CIDR/IP string
  })(),
};
