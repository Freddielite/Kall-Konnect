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

Nothing in the code can fix this. It's browser policy.

**[fixed in code]** What the code *can* do is stop it being a mystery: the
server now prints a detailed warning at startup whenever it resolves
`SameSite=None`, naming this exact failure and the fix. Watch the Render log
on first boot.

**Fix — use one parent domain.** You already own `wyntek.tech`:

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

**If you must ship on the default domains first,** test login in Chrome (not
Brave) and expect Safari/Brave users to fail. Treat it as temporary.

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
| `VITE_APPLE_CLIENT_ID`    | must match `APPLE_CLIENT_ID` on Render  |

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

If Google or Apple sign-in is live, update the provider consoles — they still
point at your LAN IP or localhost:

- **Google Cloud Console** → Credentials → your Web client → Authorized
  JavaScript origins: add `https://app.wyntek.tech`
- **Apple Developer** → your Services ID → domains and return URLs

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
