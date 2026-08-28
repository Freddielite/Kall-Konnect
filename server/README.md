# Kall Konnect — server

Plain Express + Postgres backend, replacing Supabase entirely:

| Old (Supabase)            | New (here)                                              |
|----------------------------|----------------------------------------------------------|
| `auth.users` + Supabase Auth | `users` table, `routes/auth.js` (email/password, Google) |
| Row Level Security (RLS)   | Every route filters by `req.userId` explicitly — see `middleware/requireAuth.js` |
| Supabase Realtime          | Plain WebSockets — `ws.js`, `useRealtime()` on the frontend |
| Edge Function + `pg_cron`  | `jobs/generateNotifications.js` + `jobs/cron.js` (node-cron) |
| Auth's OAuth-provider (MCP consent) | `routes/oauth.js` — our own OAuth 2.1-style authorization server |
| `supabase/functions/mcp`   | `routes/mcp.js` + `mcpTools.js` |

## Setup

If you're pointing this at a **brand new, empty Postgres**, follow the
steps below as-is. If you're adopting an **existing Supabase project's
database** — i.e. cutting over the live app rather than starting fresh —
skip to "Cutting over from an existing Supabase project" instead; the two
paths are mutually exclusive (don't run both migrations against the same
database).

1. **Postgres**: point `DATABASE_URL` at any Postgres 13+ instance you control —
   local, Docker, RDS, whatever. This is genuinely "just Postgres," no
   Supabase-specific extensions required (only `pgcrypto`, which the
   migration enables itself).

2. Copy the env template and fill it in:
   ```
   cp .env.example .env
   ```
   At minimum set `DATABASE_URL` and `JWT_SECRET` (any long random string).
   Leave `GOOGLE_CLIENT_ID` blank if you don't need that
   sign-in methods yet — the rest of the app works fine without them.

3. Install and migrate:
   ```
   npm install
   npm run migrate
   ```

4. Run it:
   ```
   npm start        # or: npm run dev  (auto-restarts on file changes)
   ```

## Cutting over from an existing Supabase project

If the live app's data already lives in a Supabase project and you want to
keep using that same Postgres instance (rather than standing up a new
empty one), use `migrations/supabase-cutover.sql` instead of `npm run
migrate`. It adopts the existing database in place:

- Creates `public.users` (the identity table this backend owns) and
  populates it from Supabase's `auth.users` + `auth.identities` —
  **reusing the same ids**, so every existing contact, call note, special
  date, and preference row keeps working with **zero data copying**.
- Repoints the foreign keys on those tables from `auth.users` to the new
  `public.users`, in place.
- Adds the `preferred_call_time`/`auto_add_calendar_reminders` columns if
  they're not already there.
- Creates the new tables this backend needs with no old equivalent
  (`refresh_tokens`, `oauth_clients`, and the rest of the OAuth token
  tables).

It does **not** touch your existing `contacts`/`call_notes`/`special_dates`/
`notifications` rows — those stay exactly as they are; only the foreign
key they point through changes.

**Before running it: back up the database.** This mutates a live
database and there's no undo built into the script — use `pg_dump`, or
Supabase Dashboard → Database → Backups if your plan supports on-demand
backups.

Get the **direct** connection string (not the pooled one — you need
`auth` schema access, which the pooler/anon connection doesn't grant)
from Supabase Dashboard → Project Settings → Database → Connection
string, using the `postgres` role on port 5432. Then:

```
psql "postgres://postgres:[password]@[host]:5432/postgres" -f migrations/supabase-cutover.sql
```

It's wrapped in one transaction — if anything fails partway, nothing is
left half-applied. It's also safe to run more than once (every step
checks before acting).

After it commits, point this project's `DATABASE_URL` at that same
connection string and run `npm start` as usual. **Test logging in with a
real existing account's real password before decommissioning the old
Supabase-Auth-based app** — Supabase Auth hashes passwords with standard
bcrypt, which is what this backend's login also expects, so existing
passwords should carry over untouched, but confirm it with a real login
rather than assuming.

Google-only accounts (no password set) migrate the same way — their
`google_sub` gets pulled from `auth.identities`, so signing
back in with the same provider should link straight to their existing
account and data.

## Google Sign-In

1. Google Cloud Console → APIs & Services → Credentials → **Create OAuth
   client ID** → type **Web application**.
2. Add your frontend's origin (e.g. `http://localhost:5173`, and your real
   domain in production) under **Authorized JavaScript origins**. You do
   *not* need a redirect URI here — Google Identity Services returns the ID
   token straight to the browser.
3. Put the client ID in **both**:
   - `server/.env` → `GOOGLE_CLIENT_ID`
   - the frontend's `.env` → `VITE_GOOGLE_CLIENT_ID`

## The MCP / OAuth flow, if you're testing it

This replaces Supabase Auth's OAuth-provider feature. An MCP client:

1. `POST /oauth/register` with `{ redirect_uris, client_name }` → gets a `client_id`.
2. Sends the user's browser to `GET /oauth/authorize?...&code_challenge=...&code_challenge_method=S256`
   (PKCE is required — every client is treated as "public"). We bounce that
   browser to the frontend's `/oauth/consent` page, which must be signed in
   with a normal app session already.
3. User approves → frontend calls our `/oauth/authorize/approve` → gets a
   `redirect_url` with a `code` → browser lands back on the MCP client's
   `redirect_uri`.
4. MCP client exchanges the code at `POST /oauth/token` (`grant_type=authorization_code`,
   plus `code_verifier`) → gets an `access_token`/`refresh_token` pair.
5. MCP client calls `POST /mcp` with `Authorization: Bearer <access_token>`
   and a JSON-RPC body (`initialize`, `tools/list`, `tools/call`).

This was tested end-to-end manually with `curl` during development — see
the tool-call transcript in the project's build notes if you want to
replay it yourself.

## Notifications

`jobs/cron.js` schedules the same daily-06:00 generation the old
`pg_cron` + edge function did. To trigger it manually instead of waiting:

```js
node -e "import('./src/jobs/generateNotifications.js').then(m => m.generateNotifications()).then(console.log)"
```
