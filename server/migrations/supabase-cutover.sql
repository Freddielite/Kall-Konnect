-- Kall Konnect: Supabase cutover script.
--
-- Use this INSTEAD OF migrations/001_init.sql when pointing the new server
-- at an EXISTING Supabase project's Postgres database (i.e. the one the
-- live, Supabase-Auth-based app already uses) — not for a fresh empty DB.
--
-- What this does:
--   1. Creates public.users (identity table the new backend owns) and
--      populates it from Supabase's auth.users + auth.identities, reusing
--      the SAME ids — so every existing contact/note/preference row keeps
--      working with zero data copying.
--   2. Repoints the foreign keys on contacts/call_notes/special_dates/
--      notifications/user_preferences from auth.users to the new
--      public.users, in place.
--   3. Adds the two preference columns the new Settings page needs
--      (idempotent — safe whether or not you already applied the earlier
--      wire_up_settings_and_notifications.sql to this project).
--   4. Creates the new tables this backend needs that have no old
--      equivalent: refresh_tokens, oauth_clients,
--      oauth_authorization_codes, oauth_access_tokens,
--      oauth_refresh_tokens, push_subscriptions.
--   5. Marks itself as having done the job of the regular numbered
--      migrations, so a later `npm run migrate` only applies genuinely
--      new ones instead of re-running work this script already did.
--
-- What this does NOT touch: your existing contacts, call_notes,
-- special_dates, and notifications rows are never copied or rewritten —
-- only the foreign key they point through changes.
--
-- ── BEFORE YOU RUN THIS ─────────────────────────────────────────────────
-- This mutates a live database. Back it up first — either a `pg_dump`,
-- or Supabase Dashboard > Database > Backups > "create a backup now" if
-- you're on a plan that supports it. There is no undo built into this
-- script.
--
-- Run it with the DIRECT (non-pooled) connection string from Supabase
-- Dashboard > Project Settings > Database > Connection string (the one on
-- port 5432, using the `postgres` role — you need access to the `auth`
-- schema, which the pooled/anon connection strings don't grant):
--
--   psql "postgres://postgres:[password]@[host]:5432/postgres" -f server/migrations/supabase-cutover.sql
--
-- It's wrapped in one transaction — if anything fails, nothing is left
-- half-applied.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── 1. The new identity table, populated from Supabase Auth ───────────

CREATE TABLE IF NOT EXISTS public.users (
  id UUID PRIMARY KEY, -- NOT gen_random_uuid() default: we assign auth.users' existing ids explicitly below
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT,
  display_name TEXT,
  google_sub TEXT UNIQUE,
  apple_sub TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Supabase Auth (GoTrue) hashes passwords with standard bcrypt, which is
-- what our own bcryptjs-based login also expects — so existing users'
-- passwords should carry over and just work. Confirm with a real login
-- test after cutover before considering this done.
INSERT INTO public.users (id, email, password_hash, display_name, google_sub, apple_sub, created_at)
SELECT
  u.id,
  u.email,
  u.encrypted_password,
  COALESCE(u.raw_user_meta_data->>'display_name', u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name'),
  (SELECT COALESCE(i.provider_id, i.identity_data->>'sub', i.identity_data->>'id')
     FROM auth.identities i WHERE i.user_id = u.id AND i.provider = 'google' LIMIT 1),
  (SELECT COALESCE(i.provider_id, i.identity_data->>'sub', i.identity_data->>'id')
     FROM auth.identities i WHERE i.user_id = u.id AND i.provider = 'apple' LIMIT 1),
  u.created_at
FROM auth.users u
ON CONFLICT (id) DO NOTHING;

-- ── 2. Repoint existing tables' foreign keys onto public.users ─────────
-- Drops whichever FK constraint currently points user_id at auth.users
-- (name varies) and adds a fresh one pointing at public.users instead.
-- Only touches tables that actually exist and actually have such a
-- constraint, so this is safe to re-run.

DO $$
DECLARE
  tbl text;
  fk record;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['contacts', 'call_notes', 'special_dates', 'notifications', 'user_preferences']
  LOOP
    IF to_regclass('public.' || tbl) IS NULL THEN
      CONTINUE;
    END IF;

    FOR fk IN
      SELECT conname FROM pg_constraint
      WHERE conrelid = ('public.' || tbl)::regclass
        AND contype = 'f'
        AND confrelid = 'auth.users'::regclass
    LOOP
      EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', tbl, fk.conname);
    END LOOP;

    -- Skip if already pointing at public.users (e.g. script re-run)
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = ('public.' || tbl)::regclass
        AND contype = 'f'
        AND confrelid = 'public.users'::regclass
    ) THEN
      EXECUTE format(
        'ALTER TABLE public.%I ADD CONSTRAINT %I_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE',
        tbl, tbl
      );
    END IF;
  END LOOP;
END $$;

-- ── 3. Preference columns added for the new Settings controls ─────────

ALTER TABLE public.user_preferences
  ADD COLUMN IF NOT EXISTS preferred_call_time TEXT NOT NULL DEFAULT 'evening'
    CHECK (preferred_call_time IN ('morning', 'afternoon', 'evening', 'anytime')),
  ADD COLUMN IF NOT EXISTS auto_add_calendar_reminders BOOLEAN NOT NULL DEFAULT false;

-- ── 4. New tables with no old equivalent ────────────────────────────────

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id);

CREATE TABLE IF NOT EXISTS oauth_clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id TEXT NOT NULL UNIQUE,
  client_secret_hash TEXT,
  client_name TEXT NOT NULL,
  redirect_uris TEXT[] NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS oauth_authorization_codes (
  code TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  redirect_uri TEXT NOT NULL,
  scope TEXT,
  code_challenge TEXT,
  code_challenge_method TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  used BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS oauth_access_tokens (
  token_hash TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  scope TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_oauth_access_tokens_user ON oauth_access_tokens(user_id);

CREATE TABLE IF NOT EXISTS oauth_refresh_tokens (
  token_hash TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  scope TEXT,
  revoked BOOLEAN NOT NULL DEFAULT false,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON push_subscriptions(user_id);

-- ── 5. Bootstrap the migration tracker ──────────────────────────────────
-- This script does the same job as migrations/001_init.sql and
-- migrations/002_push_subscriptions.sql, just adapted for an existing
-- database instead of a fresh one. Mark both as already applied so a
-- later `npm run migrate` doesn't try to run them again (which would fail
-- — those tables already exist) and only picks up genuinely new
-- migrations going forward.
CREATE TABLE IF NOT EXISTS schema_migrations (
  filename TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO schema_migrations (filename) VALUES
  ('001_init.sql'),
  ('002_push_subscriptions.sql')
ON CONFLICT (filename) DO NOTHING;

COMMIT;

-- After this commits: point server/.env's DATABASE_URL at this same
-- database (the direct connection string works fine for ongoing use, or
-- switch to the session pooler if you prefer), start the server, and test
-- logging in with a real existing account BEFORE decommissioning the old
-- Supabase-Auth-based app.
