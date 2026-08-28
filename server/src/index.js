import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import http from 'node:http';
import { env } from './env.js';
import { authRouter } from './routes/auth.js';
import { contactsRouter } from './routes/contacts.js';
import { preferencesRouter } from './routes/preferences.js';
import { notificationsRouter } from './routes/notifications.js';
import { oauthRouter } from './routes/oauth.js';
import { googleCalendarRouter } from './routes/googleCalendar.js';
import { mcpRouter } from './routes/mcp.js';
import { pushRouter } from './routes/push.js';
import { requireAuth } from './middleware/requireAuth.js';
import { attachWebSocketServer } from './ws.js';
import { startCronJobs } from './jobs/cron.js';
import { checkCookieConfig, SAME_SITE } from './lib/cookies.js';

const app = express();

// MUST come before the rate limiters. Behind a reverse proxy (Render, Fly,
// Heroku) req.ip is the proxy's address unless this is set, which collapses
// every user into one rate-limit bucket — the forgot-password limiter is
// 5/hour, so the 6th reset request from ANY user would 429 and send no email.
app.set('trust proxy', env.trustProxy);

app.use(cors({
  origin: (origin, callback) => {
    // No Origin header (curl, server-to-server, some native apps) — allow.
    if (!origin || env.corsOrigins.includes(origin)) return callback(null, true);
    // Tagged so the error handler at the bottom can turn this into a clear
    // 403 instead of letting express's default handler render it as a
    // generic 500 HTML page with a stack trace.
    const err = new Error(`Origin ${origin} is not allowed. Add it to CORS_ORIGIN in server/.env.`);
    err.status = 403;
    err.corsOrigin = origin;
    callback(err);
  },
  credentials: true,
}));
app.use(express.json());
app.use(cookieParser());

app.get('/health', (req, res) => res.json({ ok: true }));

// Public: registration/login/refresh, and the OAuth authorization server
// (its /authorize step must be reachable without an app session — see
// routes/oauth.js for how it bounces to the authenticated consent screen).
app.use('/auth', authRouter);
app.use(oauthRouter);

// Google Calendar connect/callback/status/disconnect. Mounted here (not
// behind the blanket `requireAuth` below) because /google-calendar/callback
// must be reachable with no session — Google calls it directly, identity
// comes from the signed state param instead. The other routes in this
// router apply requireAuth themselves, per-route.
app.use(googleCalendarRouter);

// OAuth-token-protected: the MCP tool endpoint (separate token space from
// the app's own JWTs — see middleware/requireOAuthToken.js).
app.use(mcpRouter);

// Push subscription management — the public-key route is public, the
// subscribe/unsubscribe routes apply requireAuth themselves.
app.use(pushRouter);

// App-session-protected: everything the frontend itself calls.
app.use(requireAuth, contactsRouter);
app.use(requireAuth, preferencesRouter);
app.use(requireAuth, notificationsRouter);

// Unmatched route — answer in JSON, because the frontend's api client
// parses every response body as JSON and express's default 404 is HTML.
app.use((req, res) => {
  res.status(404).json({ error: `No route for ${req.method} ${req.path}` });
});

// Final error handler. Must take four arguments for express to recognise it
// as one, and must be registered after every route.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err?.corsOrigin) {
    // The single most common "my app can't reach the backend" cause, and
    // previously the least legible: it surfaced as a 500 plus a stack trace
    // here, and as a bare "Failed to fetch" in the browser. Name the origin
    // and the fix in both places.
    console.warn(
      `[cors] Rejected ${req.method} ${req.path} from origin ${err.corsOrigin}\n` +
        `[cors] → Allowed: ${env.corsOrigins.join(', ') || '(none!)'}\n` +
        `[cors] → Fix: add ${err.corsOrigin} to CORS_ORIGIN in server/.env and restart.`
    );
    return res.status(403).json({ error: err.message });
  }

  const status = Number(err?.status) || 500;
  if (status >= 500) console.error('[error]', err);
  res.status(status).json({
    error: status >= 500 ? 'Internal server error' : err?.message || 'Request failed',
  });
});

const server = http.createServer(app);
attachWebSocketServer(server);
startCronJobs();

server.listen(env.port, () => {
  console.log(`Kall Konnect server listening on http://localhost:${env.port}`);
  console.log(
    `[config] env=${env.isProduction ? 'production' : 'development'} ` +
      `trustProxy=${JSON.stringify(env.trustProxy)} ` +
      `cookies=SameSite:${SAME_SITE}/Secure:${env.cookieSecure}${env.cookieDomain ? `/Domain:${env.cookieDomain}` : ''}`
  );
  console.log(`[config] CORS allows: ${env.corsOrigins.join(', ') || '(none!)'}`);

  if (env.isProduction && !env.trustProxy) {
    console.warn(
      '\n[proxy] NOTE: running in production with trust proxy disabled.\n' +
        '[proxy] → If this is behind a load balancer, set TRUST_PROXY=1 or rate limiting will ' +
        'treat every user as the same client.'
    );
  }

  const problems = checkCookieConfig();
  for (const p of problems) {
    console.warn(`\n[config] ${p.fatal ? 'BROKEN' : 'NOTE'}: ${p.message}\n[config] → ${p.fix}`);
  }
  if (problems.some((p) => p.fatal)) {
    console.warn('\n[config] The above WILL break in production. Run: npm run email-doctor\n');
  }
});
