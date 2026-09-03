# Deploying Kall Konnect (Vercel + Render)

Ordered by how likely each item is to bite you.

Items marked **[fixed in code]** are already handled by this repo — they're
listed so you know what the code is doing, not because you need to act.

---

## 1. Cross-site cookies will break login in Brave and Safari — BLOCKER

`kk.vercel.app` → `kk.onrender.com` is **cross-site**. `lib/cookies.js`
correctly derives `SameSite=None` for that, which is the only setting that
*can* work. But `SameSite=None` cookies are third-party cookies, and:

- **Brave blocks them by default** (you use Brave)
- **Safari blocks them by default** (ITP)
- Chrome is phasing them out

So the login request will return 200, `Set-Cookie` will arrive, the browser
will silently drop it, and the next `/auth/me` will 401. The app will look
like it "logs in and immediately logs out." The WebSocket breaks too — it
authenticates from the same `kk_at` cookie on the upgrade request.

Nothing in the code can make the browser *keep* the cookie. It's browser
policy, and there is no site-side opt-out.

**[fixed in code]** So the client no longer depends on the cookie surviving.
Login, register, social sign-in and refresh all return the session tokens in
the response body as well as setting the cookies. The frontend checks whether
the cookies actually stuck — by looking for the non-httpOnly `kk_csrf` cookie
immediately after the response — and only if they were dropped does it keep
the tokens and send them as `Authorization: Bearer …` instead. The WebSocket
and the Google Calendar connect redirect, neither of which can carry a
header, accept the access token as an `access_token` query param.

Browsers where cookies work are untouched: nothing is stored, no bearer
header is sent, and the CSRF double-submit check still applies. See
`src/lib/session-store.ts` and `server/src/lib/session.js`.

This is a workaround, not the destination. Tokens in `localStorage` are
readable by any XSS on the page; httpOnly cookies are not. Get onto a custom
domain and this becomes dead code.

**Real fix — use one parent domain.** You already own `wyntek.tech`:

| Service  | Domain              |
| -------- | ------------------- |
| Vercel   | `app.wyntek.tech`   |
| Render   | `api.wyntek.tech`   |

Then on Render set:

```
COOKIE_DOMAIN=.wyntek.tech
```

`cookies.js` sees `COOKIE_DOMAIN` and derives `SameSite=Lax` — same-site,
first-party, blocked by nobody. This is also *safer*: under `None` the
double-submit CSRF token is your only CSRF defence.

You cannot bridge `vercel.app` and `onrender.com` with `COOKIE_DOMAIN` —
both are on the Public Suffix List. A custom domain is the only route.

**If you ship on the default domains first,** login works everywhere via the
bearer fallback above — but you're carrying the extra XSS exposure until you
move to a custom domain. Treat it as temporary.

---

## 1b. The daily reminder will not send on Render's free tier

> **Already keeping the instance awake with a pinger?** Then `node-cron` does
> fire and this section is optional. Two things still apply: set
> `CRON_TIMEZONE` (see §6) or reminders go out at 07:00 WAT rather than 06:00,
> and consider keeping the external trigger anyway — a pinger is a silent
> single point of failure, and if it stops, notifications stop with nothing
> logging an error. The job is idempotent for the day, so running it from
> both places never double-sends.


This is the single most common reason the app "doesn't send notifications"
while Web Push is configured perfectly.

`server/src/jobs/cron.js` schedules the reminder with `node-cron`, which runs
**inside the server process**. Free Render instances spin down after ~15
minutes idle. At 06:00 there is normally nothing running, so the job never
executes, no notifications are created, and no pushes are sent. Nothing logs
an error, because nothing ran.

**Fix: trigger it from outside.**

1. Generate a secret: `openssl rand -hex 32`
2. Render > your service > Environment: add `CRON_SECRET` with that value.
3. GitHub repo > Settings > Secrets and variables > Actions, add `CRON_SECRET`
   (same value) and `API_URL` (`https://your-api.onrender.com`, no trailing
   slash).

`.github/workflows/daily-reminders.yml` is already in this repo and does the
rest. It also has `workflow_dispatch`, so you can run it by hand from the
Actions tab to test.

Prefer something else? Any scheduler works:

```
curl -X POST https://your-api.onrender.com/jobs/generate-notifications \
  -H "x-cron-secret: $CRON_SECRET"
```

cron-job.org is free and fine. Render's own Cron Jobs are a paid feature. Set
the caller's timeout to at least 120s — a sleeping instance takes 30-60s to
wake before the job even starts.

Verify it works:

```
# Should be 401
curl -i -X POST https://your-api.onrender.com/jobs/generate-notifications
# Should be 200 with {"ok":true,"created":N}
curl -X POST https://your-api.onrender.com/jobs/generate-notifications \
  -H "x-cron-secret: $CRON_SECRET"
```

### Recommended: an every-few-minutes pinger instead of a daily job

`GET /jobs/tick?secret=YOUR_CRON_SECRET` is the simplest way to run this, and
the one to prefer. Point any free scheduler at it — cron-job.org is the usual
choice — set to **every 5 minutes**, and you are done. No headers, no
repository secrets, nothing to mistype but the URL itself.

Every few minutes rather than once daily is deliberate, and it is the main
reason this is more reliable than the GitHub Actions workflow:

- It keeps the Render free instance awake, so the job isn't racing a 50-second
  cold start.
- A daily trigger has exactly one attempt. If it fails, that day has no
  reminders and you find out from a user. A tick every 5 minutes means any
  single failure is corrected within 5 minutes.
- `generateNotifications()` is idempotent for the day, so the extra calls are
  a cheap query returning `created: 0`. Only ticks that actually create
  something are logged.

The GitHub Actions workflow in `.github/workflows/daily-reminders.yml` still
works and needs no external account, but it requires two repository secrets
(`API_URL` and `CRON_SECRET`), and a missing one fails in ways that are not
obvious from the run log.

A 503 means `CRON_SECRET` isn't set on the server. The server also prints a
warning at startup when `NODE_ENV=production` and no `CRON_SECRET` is set.

**Note on timezone.** GitHub's `cron:` is always UTC, so use `0 5 * * *` for
06:00 WAT. The in-process job now takes `CRON_TIMEZONE` instead — set it to
`Africa/Lagos` and leave `CRON_SCHEDULE` at `0 6 * * *`. Per-user reminder
times still aren't supported; this is one global time for everyone.

---

## 2. Render's free tier sleeps — raise the request timeout

Free instances spin down after ~15 minutes idle and take **30–60s** to wake.
The frontend gives up at 15s, so the first request after an idle period will
show "The server at … didn't respond within 15s."

**[fixed in code]** `api.ts` now derives the default from where the backend
actually is: 15s for localhost/LAN, **60s for a remote host**. So a Render
deploy already gets the longer window with no configuration.

Override if you want a different value:

```
VITE_REQUEST_TIMEOUT_MS=60000
```

Don't go below ~6000 — the DB pool gives up at 5s and returns a real error
message, and a tighter client timeout would replace it with a generic one.

---

## 3. Vercel needs an SPA rewrite

The app uses `BrowserRouter`. Without a catch-all rewrite, a hard refresh or
direct link to `/auth`, `/contacts`, or `/oauth/consent` returns Vercel's 404
instead of the app. The `/oauth/consent` deep link matters — the MCP OAuth
flow redirects the browser straight to it.

**[fixed in code]** `vercel.json` is now in the repo root. It rewrites
everything except `/assets/*` to `index.html`, and adds immutable caching for
the hashed asset filenames Vite emits. Nothing to do.

---

## 4. Render Postgres needs SSL

`server/src/db.js` sets no `ssl` option. Which URL you use decides whether
that matters:

- **Internal URL** (`...-a` host, no region suffix) — same Render network, no
  SSL needed. **Prefer this.** Faster and free of egress.
- **External URL** — requires SSL. Append `?sslmode=require` to
  `DATABASE_URL` and that's it. **[fixed in code]** `db.js` detects
  `sslmode=require` in the connection string and relaxes certificate
  verification, which managed Postgres needs because the cert is signed by
  the provider's own CA rather than one in Node's trust store. Without it
  you'd get `SELF_SIGNED_CERT_IN_CHAIN`, which reads like the database is
  unreachable.

  A plain local `postgres://localhost/...` is untouched. Set
  `DATABASE_SSL_STRICT=true` to keep full verification if you've supplied the
  provider's CA via `NODE_EXTRA_CA_CERTS`.

---

## 5. Run migrations once

Nothing runs them automatically. After the database exists, from a Render
shell or locally with `DATABASE_URL` pointed at Render:

```bash
npm run migrate
```

Check `server/migrations/` — `001_init.sql`, `002_push_subscriptions.sql`,
`003_auth_hardening.sql`. Ignore `supabase-cutover.sql`, it's historical.

---

## 6. Environment variables

### Render (backend) — root directory `server/`

| Variable         | Value                                        |
| ---------------- | -------------------------------------------- |
| `NODE_ENV`       | `production`                                 |
| `DATABASE_URL`   | Render's internal Postgres URL               |
| `JWT_SECRET`     | long random string — **not** the dev one     |
| `COOKIE_SECURE`  | `true`                                       |
| `COOKIE_DOMAIN`  | `.wyntek.tech` (see §1)                      |
| `APP_URL`        | `https://app.wyntek.tech` — **frontend** URL |
| `CORS_ORIGIN`    | `https://app.wyntek.tech`                    |
| `SENDGRID_API_KEY` | key with **Mail Send** scope               |
| `EMAIL_FROM`     | `Kall Konnect <noreply@wyntek.tech>`         |

Build `npm install`, start `npm start`. Leave `TRUST_PROXY` unset — it
auto-detects to `1` on Render.

`APP_URL` is the one people get wrong. It's baked into password-reset links,
so it must be the public **frontend** URL, never the backend's own address.

### Vercel (frontend)

| Variable                  | Value                       |
| ------------------------- | --------------------------- |
| `VITE_API_URL`            | `https://api.wyntek.tech`   |
| `VITE_WS_URL`             | `wss://api.wyntek.tech`     |
| `VITE_REQUEST_TIMEOUT_MS` | `60000` if on Render free   |
| `VITE_GOOGLE_CLIENT_ID`   | must match `GOOGLE_CLIENT_ID` on Render |

`wss://`, not `ws://` — a plain `ws://` connection from an HTTPS page is
blocked as mixed content.

**Set `VITE_API_URL` explicitly.** If it's missing, the resolver falls back to
the page's own hostname on port 4000, which is wrong in production. The
resolver never rewrites real domains, so a correct value passes through
untouched.

---

## 7. Vercel preview deploys will fail CORS

Every preview gets a unique URL (`kk-git-branch-you.vercel.app`) that isn't in
`CORS_ORIGIN`, so API calls get a 403. Since the fix, the backend log names
the rejected origin and the exact fix, so this is at least obvious.

Either add preview URLs to `CORS_ORIGIN` as needed, or accept that only
production works and test branches locally.

**Deliberately not fixed:** wildcard support (`https://*.vercel.app`) would
make previews work, but `CORS_ORIGIN` is paired with `credentials: true`, so
a wildcard over a domain *anyone can deploy to* would let any Vercel app make
authenticated requests against your API with the user's cookies. Not worth it
for preview convenience.

---

## 8. OAuth redirect URIs

If Google sign-in is live, update the provider console — it still points at
your LAN IP or localhost:

- **Google Cloud Console** → Credentials → your Web client → Authorized
  JavaScript origins: add `https://app.wyntek.tech`

---

## Post-deploy verification

Run these in order. Each one isolates a different layer.

```bash
# 1. Backend alive?
curl https://api.wyntek.tech/health
# -> {"ok":true}

# 2. CORS configured for the real frontend?
curl -i -X OPTIONS https://api.wyntek.tech/auth/login \
  -H "Origin: https://app.wyntek.tech" \
  -H "Access-Control-Request-Method: POST"
# -> 204. A 403 means CORS_ORIGIN is wrong; the body names the fix.

# 3. Cookie policy correct?
curl -i -X POST https://api.wyntek.tech/auth/login \
  -H "Content-Type: application/json" \
  -H "Origin: https://app.wyntek.tech" \
  -d '{"email":"you@example.com","password":"..."}' | grep -i set-cookie
# Want: Secure; SameSite=Lax; Domain=.wyntek.tech
# SameSite=None means COOKIE_DOMAIN didn't take -> see §1
```

Then in the browser: sign in, hard-refresh, and confirm you're still signed
in. Surviving a refresh is the real test — it proves the cookie was stored,
not just sent.

Also check Render's startup log. It prints the resolved config and warns
about cookie problems:

```
[config] env=production trustProxy=1 cookies=SameSite:lax/Secure:true/Domain:.wyntek.tech
[config] CORS allows: https://app.wyntek.tech
```
