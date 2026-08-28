# HANDOVER

Living session log for kall-konnect-mvp. Newest entries on top.

---

## 2026-08-28 (d) — Added end-user guide

Added `USER_GUIDE.md` at the repo root: a plain end-user walkthrough of the
app itself (accounts, adding/importing contacts, the Dashboard's daily
suggestion queue, conversation starters, Stats, Settings, notifications,
delete-undo, and the MCP/OAuth consent screen), plus a short "known
limitations" list pulled from the feature-ideas backlog below. This is
separate from `README.md` (local dev setup) and `DEPLOYING.md`
(Vercel/Render deploy) — neither of those explain how to use the app once
it's running, which this fills in.

No app code changed.

---

## 2026-08-28 (c) — Vercel/Render deploy review

Reviewed the split-hosting path again. The 2026-08-27 (b) pass had already
covered `trust proxy`, cookie `SameSite` derivation, the `prestart` script
and `engines`. Five gaps remained; four are now fixed in code.

**1. Postgres SSL (`server/src/db.js`).** No `ssl` option was set. Managed
Postgres presents a cert signed by the provider's own CA, so `pg` rejects
it with `SELF_SIGNED_CERT_IN_CHAIN` — which reads like the database is
unreachable, not like a TLS problem. Now detects `sslmode=require` in the
connection string and relaxes verification for that case only; local
`postgres://localhost/...` is untouched. `DATABASE_SSL_STRICT=true` keeps
full verification for anyone supplying a CA via `NODE_EXTRA_CA_CERTS`.
Render's *internal* URL needs none of this and is still the better choice.

**2. Cold starts vs the request timeout (`src/lib/api.ts`).** The 15s
timeout from (a) is right for a LAN and wrong for a free Render instance,
which sleeps after ~15 min idle and takes 30–60s to wake — the first
request after a quiet period would time out on a perfectly healthy deploy.
The default is now derived from the resolved API host: 15s local, 60s
remote. `VITE_REQUEST_TIMEOUT_MS` still overrides. Floor is still ~6s (the
DB pool's own 5s timeout); below that the client races the server and
hides real error messages.

**3. SPA rewrites (`vercel.json`, new).** `BrowserRouter` with no
catch-all meant a hard refresh on `/auth`, `/contacts` or `/oauth/consent`
returned Vercel's 404. `/oauth/consent` matters most — the MCP OAuth flow
redirects the browser straight to it. Rewrites everything except
`/assets/*`, so Vite's hashed files are still served as static assets
(verified: 8/8 path cases).

**4. Missing `VITE_API_URL` in a production build (`src/lib/api.ts`).**
The resolver's fallback is the page's own host on port 4000 — correct in
dev, never correct once deployed. Vite inlines env vars at build time so
this can't be fixed at runtime; the bundle has to be rebuilt. Now logs an
explicit error saying exactly that.

**5. Cross-site cookies — NOT fixable in code, and the likeliest
breakage.** `*.vercel.app` → `*.onrender.com` forces `SameSite=None`,
which browsers treat as a third-party cookie. Brave and Safari block those
by default; Chrome is phasing them out. Where blocked: login returns 200,
the cookie is dropped, the next call 401s, and the app appears to sign in
and immediately sign out. The WebSocket fails identically — it reads the
same `kk_at` cookie on the upgrade request.

The (b) entry framed `None` as "works, weaker CSRF". That understates it:
in two major browsers it does not work at all. `checkCookieConfig()` now
says so at startup and names the fix — put both on subdomains of one owned
domain (`app.` + `api.wyntek.tech`) and set `COOKIE_DOMAIN=.wyntek.tech`,
which gets back to `SameSite=Lax`. `*.vercel.app` and `*.onrender.com` are
both on the Public Suffix List, so `COOKIE_DOMAIN` cannot bridge them.

Verified by booting with each config: split hosting prints the warning and
resolves `SameSite:none`; the custom-domain config resolves
`SameSite:lax/Secure:true/Domain:.wyntek.tech` and prints nothing.

**Deliberately not fixed: wildcard `CORS_ORIGIN` for preview deploys.**
Each Vercel preview gets a unique URL that isn't in the allow-list, so
previews 403. A `https://*.vercel.app` wildcard would fix that, but
`CORS_ORIGIN` is paired with `credentials: true` — a wildcard over a domain
anyone can deploy to would let any Vercel app make authenticated requests
with a user's cookies. Not worth it for preview convenience.

Full checklist with env var tables and post-deploy curl checks: `DEPLOYING.md`.

---

## 2026-08-28 (b) — Confirmed: stale VITE_API_URL baked into a running Vite

The improved error from (a) named the address, which settled it. The app
was loaded from `192.168.1.162:8080` and calling `192.168.0.171:4000` — a
different subnet entirely. `server/.env` was already correct
(`CORS_ORIGIN` listed `192.168.1.162:8080`), so the backend was fine.

**Root cause: Vite inlines `import.meta.env` at dev-server START, not at
page load.** The backend had been restarted since the DHCP change, so its
`predev` hook re-synced `server/.env`. The frontend dev server had not, so
it kept serving the address from the old network. `sync-lan-ip.mjs` cannot
help here — it had already written the correct value to `.env`; the
running process simply never re-read it.

So the (a) hypothesis (a virtual adapter winning IP detection) was wrong.
Those hardening changes are still worth keeping — they close a real hole —
but this was the actual failure.

**Fix: stop trusting the baked value when the browser knows better.**
`resolveApiUrl()` in `src/lib/api.ts` compares the configured host against
`window.location.hostname`. When both are LAN/localhost addresses and they
disagree, the page's own host wins — the browser reached this page
somehow, and the backend is on the same machine, so that address is
correct by construction. This also fixes the long-standing "works on the
dev machine, not from my phone" case where `VITE_API_URL` says
`localhost`.

Real domains are never rewritten, so Vercel/Render deploys are unaffected.
`VITE_API_URL_EXACT=true` opts out for a genuine split-machine setup.
`VITE_WS_URL` goes through the same resolver. 13 resolver cases covered,
plus an end-to-end run over real sockets: stale address → ECONNREFUSED,
same config through the resolver → 200.

**Practical upshot:** a LAN IP change no longer requires restarting the
frontend dev server. The console still warns when the correction fires, so
the stale `.env` is visible rather than silently papered over.

---

## 2026-08-28 (a) — "signal is aborted without reason" on sign-in

That string is not ours. It's the browser's default `DOMException` message
when an `AbortController` cancels a `fetch`. `api.ts` put an 8s timeout on
every request, and `errorMessage()` returned `error.message` verbatim, so a
backend that didn't answer in 8s surfaced as a toast describing *the
mechanism that cancelled the request* rather than anything actionable.

**Ruled out by measurement**, so nobody re-checks them: bcryptjs at cost 12
is ~335ms (hash and compare both). A dead Postgres returns
`{"error":"Could not sign in"}` in 33ms, not a hang. A rejected CORS origin
fails immediately too. None of these can produce a multi-second hang.

A hang means the TCP connection is never accepted *and* never refused —
the signature of an address where nothing is listening and a firewall is
dropping packets rather than sending a reset. That points at `VITE_API_URL`.

**Most likely root cause: `detectLanIp()` in `scripts/sync-lan-ip.mjs` could
pick a virtual adapter.** It took the first `192.168.x` it found, in
`os.networkInterfaces()` order. A VirtualBox host-only adapter
(`192.168.56.1`) or a Windows ICS/hotspot adapter (`192.168.137.1`) sorts
equal to the real Wi-Fi address, so either could win. Vite binds every
interface, so the app still *loads* over the real LAN IP while every API
call goes to an address nothing answers on — and hangs until the client
timeout. Silent, and it looks like an app bug.

**What changed:**

- `src/lib/api.ts` — failures are now `ApiError` (server answered non-2xx)
  or `NetworkError` (`kind: 'timeout' | 'unreachable'`), with the address
  actually tried in the message, plus a fuller diagnosis to the console in
  dev builds. Timeout 8s → 15s, and configurable via
  `VITE_REQUEST_TIMEOUT_MS`. **Never set it below ~6s**: the DB pool gives
  up at 5s (`connectionTimeoutMillis`) and returns a real error, so a
  tighter client timeout races the server and replaces the real message
  with a generic one. Also: trailing slashes in `VITE_API_URL` are now
  stripped, refresh failures resolve `false` instead of throwing (a
  speculative refresh must not replace the caller's real error), and empty
  bodies no longer blow up `res.json()`.
- `src/lib/utils.ts` — `errorMessage()` backstops any abort/`Failed to
  fetch` that doesn't go through `api.ts`.
- `scripts/sync-lan-ip.mjs` — detection now asks the OS which interface
  carries the default route (UDP `connect()` sends no packets; it just
  makes the kernel run its routing table), which is authoritative rather
  than a guess. Name/range heuristics remain as the offline fallback, now
  excluding vboxnet/vEthernet/hotspot/APIPA. `LAN_IP=<addr>` overrides
  everything. Rejected candidates are printed, so a wrong pick is visible
  in the dev-server output instead of showing up as a mystery timeout.
- `scripts/sync-lan-ip.mjs` — **separate bug**: `mergeCorsOrigin()` kept
  *only* the two localhost origins, silently deleting any hand-added one
  (a deployed frontend, a second test device) on every dev-server start.
  Now drops only stale IP-literal origins.
- `server/src/index.js` — CORS rejections were a 500 with an HTML stack
  trace; now a 403 JSON plus a log line naming the origin, the allow-list,
  and the fix. Added a JSON error handler so 5xx stops returning HTML that
  `api.ts` can't parse.

**Note:** the LAN-IP diagnosis is inference, not confirmation — the `.env`
files aren't in version control, so the actual bad value was never seen.
The new output settles it either way: the toast names the address it tried,
and `[sync-lan-ip]` lists the candidates it rejected.

**Stale docs corrected:** the section below claims `npm start` syncs the LAN
IP. It doesn't — `prestart` was deliberately removed on 2026-08-27 (b) so
Render deploys wouldn't bake a container's internal 10.x address into
`APP_URL`. Only `npm run dev` syncs.

---

## 2026-08-27 (e) — Delete-menu icon bug + delete modal too wide on mobile

`ContactCard.tsx` was importing lucide's `MoveVertical` (↕) aliased as
`MoreVertical` — the dropdown trigger button was showing the wrong icon the
whole time. Fixed to import the actual `MoreVertical` (⋮) icon. Also the
delete confirmation `AlertDialogContent` used the base component's default
`w-full`, which spans edge-to-edge with no side margin on mobile; scoped a
`w-[calc(100%-2rem)] max-w-sm` on this instance so it stays narrow.

---

## 2026-08-27 (d) — Undo-on-delete for contacts

Picked off the feature-ideas list. `deleteContact` in `useContacts.ts` no
longer calls the API immediately: it optimistically removes the contact from
local state and shows a sonner toast ("`<name>` deleted") with an Undo action,
holding the real `DELETE /contacts/:id` in a 5s `setTimeout`. Undo clears the
timeout and re-adds the contact to state — no refetch needed. A realtime
refetch during the undo window won't resurrect the contact (pending IDs are
filtered out of `fetchContacts`'s result), and pending deletes are flushed on
unmount instead of silently dropping. `ContactCard`'s confirm dialog copy
updated since delete is no longer irreversible.

Remaining feature ideas untouched: Web Push notifications, calling streaks,
duplicate-contact detection on import, click-to-call/WhatsApp from the
dashboard card.

---

## 2026-08-27 (c) — "Still didn't send" was actually a delivery failure

The doctor came back clean: key valid, `mail.send` present, live send accepted
with a 202 and a message id. So the API path was never the problem.

**Root cause: `EMAIL_FROM` was `wynteknologies@gmail.com`.** You can't send as
a gmail.com address through SendGrid. gmail.com publishes SPF/DKIM/DMARC
records that don't list SendGrid's servers, and you can't change them because
you don't own the domain. Every message fails DMARC alignment, so the
receiving provider junks or refuses it. SendGrid still returns 202, which is
what made this look like "not sending" rather than "not delivering".

Single Sender Verification does *not* fix this — it only proves you control
the inbox, not the domain. It's why the send was accepted at all.

Sending from a Gmail address *to* a Gmail address is the worst possible test:
mail claiming to be from a Gmail user but arriving from an outside server is
the exact shape of a spoofing attack.

**Fix:** SendGrid > Settings > Sender Authentication > Authenticate Your
Domain, add the CNAMEs to the wyntek.tech DNS, then
`EMAIL_FROM="Kall Konnect <noreply@wyntek.tech>"`.

`checkEmailConfig()` now warns on ~20 free-mail domains (gmail, yahoo,
outlook, icloud, proton, gmx…) at startup and in the doctor. It's non-fatal by
design: SendGrid accepts these, so nothing can detect it at send time. The
doctor also now explains what each Activity Feed status means, since a 202
alone tells you nothing about delivery.

---

## 2026-08-27 (b) — Made it deployable to Vercel + Render

Four things would have broken a split Vercel (frontend) / Render (backend)
deploy. None were email-specific, but the first two look exactly like
"emails stopped sending".

**1. `prestart` ran the LAN-IP script on every boot.** `scripts/sync-lan-ip.mjs`
detects the *container's* internal 10.x address on Render and writes it into
`APP_URL`/`CORS_ORIGIN`, baking a dead address into password-reset links. It
also scaffolds `server/.env` from `.env.example`, dragging in placeholder
values (`EMAIL_FROM=you@example.com`) for anything not set in the dashboard.
And if Render's root directory is `server/`, `../scripts/` doesn't exist, so
`npm start` exits non-zero and the deploy fails outright.
Fixed twice over: the script now no-ops when it sees `NODE_ENV=production` or
a platform marker (`RENDER`, `VERCEL`, `CI`, Fly, Heroku, Cloud Run), and the
`prestart` hook is gone entirely — `npm start` is the production command, so
the LAN sync now only hangs off `predev` (with `|| true` so a missing script
can't break dev either).

**2. No `app.set('trust proxy')`.** Behind Render's load balancer `req.ip` is
the proxy's address for every request, so all users share one rate-limit
bucket. Measured with 10 distinct users through one proxy hop against the
5/hour forgot-password limit:

    trust proxy OFF   5/10 distinct users blocked
    trust proxy = 1   0/10 distinct users blocked

So in production the 6th password reset from *anyone* would 429 and send no
email. express-rate-limit v7 also raises `ERR_ERL_UNEXPECTED_X_FORWARDED_FOR`.
Now set from `env.trustProxy`, auto-detecting to 1 on Render / in production.

**3. Cookies were hardcoded `sameSite: 'lax'`.** `*.vercel.app` →
`*.onrender.com` is cross-site, so the browser never sends Lax cookies on the
API's XHR calls and login silently does nothing. `lib/cookies.js` now derives
the policy:

    COOKIE_DOMAIN set        -> lax   (shared parent domain, same-site)
    HTTPS, no COOKIE_DOMAIN  -> none  (split hosting)
    plain http dev           -> lax

`SameSite=None` forces `Secure` on, since browsers reject that pairing and
drop the cookie with no error. Both `vercel.app` and `onrender.com` are on
the Public Suffix List, so `COOKIE_DOMAIN` can't bridge them — a custom
domain (`app.` + `api.` on one parent) is the only route back to Lax, which
is worth doing: under `None` the double-submit CSRF token is the sole CSRF
defence. `COOKIE_SAMESITE` overrides the derivation.

**4. No `engines`.** Pinned `node >=20` in both package.json files —
the code needs global `fetch` and `AbortSignal.timeout`.

Startup now prints resolved config (env, trustProxy, cookie policy, CORS
origins, APP_URL) and flags cookie problems alongside the email ones.

**Deploy settings** are documented at the bottom of `server/.env.example`.
The one people get wrong: `APP_URL` must be the public *frontend* URL, since
that's what reset links are built from.

---

## 2026-08-27 — Password reset / verification emails "not sending"

**Symptom:** a valid `SENDGRID_API_KEY` set, but no mail arriving, and no
error anywhere.

**Why it was invisible:** both auth routes swallow email errors by design —
a dead mailer must not block signup, and surfacing errors from
`/forgot-password` would turn it into an account-enumeration oracle. So the
UI reported success in *every* failure mode, and the only trace was one
`console.error` that was easy to scroll past.

**What changed** (none of it weakens the enumeration defence — the HTTP
response is still generic; the difference is all server-side logging):

- `env.js` now loads `server/.env` by explicit path instead of via
  `dotenv/config`, which resolved against `process.cwd()`. Starting from the
  repo root silently loaded the root (Vite-only) `.env`, so the key came back
  empty and email fell into console/dev mode with no signal.
- `env.js` trims `SENDGRID_API_KEY` and `EMAIL_FROM`. A trailing space or a
  newline from a wrapped paste survives dotenv and breaks the Bearer header,
  which reads as "the key is wrong".
- `lib/email.js` gained `checkEmailConfig()`, which refuses to send on a
  known-bad config (placeholder `EMAIL_FROM`, malformed key) and explains
  why. 401/403/429 responses now map to actionable messages instead of a
  bare status code. Transient failures (429/5xx/network) retry 3x with
  backoff; config failures don't, since retrying can't help.
- `index.js` runs that same check at boot, so a broken config announces
  itself on startup rather than at first password reset.
- `routes/auth.js` splits token issuance from sending, so the log
  distinguishes "`auth_tokens` doesn't exist, run `npm run migrate`" from
  "SendGrid rejected the send" — these previously looked identical.
- Dev-mode email logging now prints the reset/verify link on its own line
  instead of burying it in an HTML dump.
- New `npm run email-doctor` (`server/scripts/email-doctor.mjs`): checks the
  key's scopes, cross-references `EMAIL_FROM` against verified senders,
  scans the four suppression lists, and optionally sends a live test through
  the app's own `sendEmail()`. Add a recipient to send:
  `npm run email-doctor -- you@gmail.com`.

**The two most likely root causes**, both of which the doctor names directly:
the API key lacks the `mail.send` scope (a Restricted Access key without it
authenticates fine and 403s every send), or `EMAIL_FROM` doesn't exactly
match a verified Single Sender. Both are now documented in `.env.example`.

**Unrelated but worth knowing:** `scripts/sync-lan-ip.mjs` rewrites `APP_URL`
to the current LAN IP on every `npm start`, so reset links get baked with
that IP and won't open from outside the network even when the mail arrives.

## LAN IP keeps changing when testing from your phone?

DHCP reassigns this machine's IP whenever it reconnects to a network —
that's what kept breaking `VITE_API_URL`/`CORS_ORIGIN`. `npm run dev`
(both root and `server/`) auto-detects the current LAN IP and rewrites both
`.env` files before starting, via `scripts/sync-lan-ip.mjs`. You shouldn't
need to hand-edit an IP into either `.env` again. Run it standalone any
time with `npm run sync-ip`, and pin it with `LAN_IP=192.168.1.50 npm run dev`
if autodetection picks the wrong interface.

**`npm start` does NOT sync** — the `prestart` hook was removed on
2026-08-27 (b) so Render deploys wouldn't bake a container's internal 10.x
address into `APP_URL`. That's deliberate; use `npm run dev` locally.

This masks the symptom, not the cause — for a permanent fix, set a DHCP
reservation (a.k.a. static lease) for this machine in your router's admin
page, so its IP stops changing at all.

## 2026-08-26 — Ripped Supabase out, rebuilt on plain Postgres + Express

**What happened:** Full backend migration off Supabase. Auth, RLS,
Realtime, and the edge function/OAuth-provider setup are gone, replaced
by `server/` (Express + plain Postgres). See `server/README.md` for the
architecture table and setup steps. Frontend hooks/pages rewired to a new
`lib/api.ts` fetch client + `lib/auth-context.tsx` + `lib/realtime.ts`
(WebSocket). Scope decisions made along the way: full auth parity
(email/password + Google + Apple + MCP OAuth), and WebSocket realtime kept
rather than dropped to plain refetch.

Also fixed two real timezone bugs during the original bug-fix pass and
one more caught mid-migration:
- Birthday/anniversary/special-date save path was off by one day for
  positive-UTC-offset users (`toLocalDateString`/`parseLocalDate` in
  `src/lib/utils.ts` fix this).
- `pg`'s default driver parsed `DATE` columns into JS `Date` objects,
  which serialized as full UTC timestamps instead of bare `YYYY-MM-DD`
  strings — broke the frontend's date parsing contract. Fixed in
  `server/src/db.js` by overriding the type parser for OID 1082.
- CORS default port mismatch (`vite.config.ts` uses 8080, old default
  `CORS_ORIGIN` assumed Vite's 5173 default) caused "Failed to fetch" on
  fresh setups. `CORS_ORIGIN` now takes a comma-separated list.

### Known gaps / worth fixing soon

_All five items below were fixed as part of an auth-hardening pass._

- ~~No "forgot password" flow.~~ **Fixed.** `POST /auth/forgot-password` +
  `POST /auth/reset-password`, tokens in the new `auth_tokens` table
  (hashed, 1hr TTL), emailed via SendGrid. `SENDGRID_API_KEY` unset →
  logs the email to the console instead of sending, so this still works
  with zero config in dev.
- ~~No rate limiting on `/auth/login` or `/auth/register`.~~ **Fixed.**
  `server/src/middleware/rateLimit.js` — 10 attempts/15min on login+register,
  5/hour on forgot-password.
- ~~Access tokens live in `localStorage`.~~ **Fixed.** Auth now lives in
  httpOnly cookies (`kk_at`/`kk_rt`), set/read via
  `server/src/lib/cookies.js`. Added double-submit CSRF protection (`kk_csrf`
  cookie + `X-CSRF-Token` header) since cookie-based sessions need it —
  see `requireAuth.js`. Frontend `api.ts` now sends `credentials: 'include'`
  everywhere instead of an `Authorization` header. WebSocket auth
  (`ws.js`) reads the same cookie off the upgrade request instead of a
  `?token=` query param.
- ~~No email verification on signup.~~ **Fixed.** New `users.email_verified`
  column (Google/Apple sign-ins are marked verified immediately; existing
  accounts backfilled true). `POST /auth/verify-email`,
  `POST /auth/resend-verification`. Not enforced anywhere yet — login isn't
  gated on it, by design, to avoid locking anyone out. Settings shows a
  "resend link" banner when unverified.
- ~~`auto_add_calendar_reminders` setting persists but does nothing.~~
  **Fixed, pragmatically.** We don't have Google/Apple Calendar OAuth, so
  real two-way calendar sync is a bigger feature, not a gap-fix. Instead:
  when this is on, a `planned_call` reminder now emails the user a `.ics`
  invite (works with Google/Apple/Outlook — one-tap "add to calendar" from
  the email). See `generateNotifications.js` + `lib/ics.js`.

**New env vars to set** (see `server/.env.example`): `SENDGRID_API_KEY`,
`EMAIL_FROM`, `COOKIE_SECURE` (leave `false` for LAN/http dev, `true` once
on HTTPS), `COOKIE_DOMAIN` (leave blank outside of a real prod domain).
Run `npm run migrate` to pick up `003_auth_hardening.sql`.

### Feature ideas (not started)

- Real push notifications (Web Push) — the bell only surfaces reminders
  while a tab is open; a check-in app arguably lives or dies on actually
  reaching you at the right moment.
- Calling streaks ("called Mom every week for 6 weeks") — light
  gamification fitting the habit-maintenance angle of the app.
- Duplicate contact detection on import (fuzzy name+phone match) —
  natural next step given the import dialog already exists.
- Click-to-call / one-tap WhatsApp directly from the dashboard card
  instead of requiring a trip to the Contacts page.
- Undo-on-delete — deleting a contact is currently immediate and
  permanent; a 5-second "Undo" toast would prevent accidental taps from
  being unrecoverable.
- Search/filter on the Contacts page, if not already present — worth
  checking.
