-- Kall Konnect: plain-Postgres schema.
--
-- This replaces Supabase's setup entirely:
--   - auth.users            -> public.users (we own password/OAuth identity now)
--   - Row Level Security    -> every route in server/src/routes/* filters by
--                              req.user.id explicitly; there is no RLS here,
--                              so a bug in a route is not caught by the DB.
--   - Supabase Realtime     -> server/src/ws.ts broadcasts over plain WebSockets
--   - Supabase Auth OAuth   -> server/src/routes/oauth.ts (our own authorization
--                              server for the MCP client flow)

CREATE EXTENSION IF NOT EXISTS pgcrypto; -- gen_random_uuid()

-- ─────────────────────────────────────────────────────────────────────────
-- Users & auth
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT,                 -- null for accounts that only ever used Google/Apple
  display_name TEXT,
  google_sub TEXT UNIQUE,             -- Google's stable subject id, once linked
  apple_sub TEXT UNIQUE,              -- Apple's stable subject id, once linked
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Opaque refresh tokens for our own app sessions (not the MCP OAuth flow below).
-- We store a hash, never the raw token.
CREATE TABLE refresh_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_refresh_tokens_user ON refresh_tokens(user_id);

-- ─────────────────────────────────────────────────────────────────────────
-- App data (unchanged shape from the Supabase version, minus RLS)
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE user_preferences (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  notifications_enabled BOOLEAN NOT NULL DEFAULT true,
  reminder_time TEXT DEFAULT '09:00',
  theme TEXT DEFAULT 'system' CHECK (theme IN ('light', 'dark', 'system')),
  notification_frequency TEXT NOT NULL DEFAULT 'daily' CHECK (notification_frequency IN ('daily','weekly','monthly')),
  inactivity_days INTEGER NOT NULL DEFAULT 14,
  preferred_platforms JSONB DEFAULT '[]'::jsonb,
  call_frequency TEXT DEFAULT 'weekly' CHECK (call_frequency IN ('weekly','biweekly','monthly')),
  reminder_tone TEXT DEFAULT 'friendly' CHECK (reminder_tone IN ('friendly','professional','casual')),
  favorite_contacts JSONB DEFAULT '[]'::jsonb,
  preferred_call_time TEXT NOT NULL DEFAULT 'evening' CHECK (preferred_call_time IN ('morning','afternoon','evening','anytime')),
  auto_add_calendar_reminders BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone TEXT,
  phone_secondary TEXT,
  whatsapp_phone TEXT,
  avatar TEXT,
  relationship TEXT NOT NULL CHECK (relationship IN ('family', 'friend', 'colleague', 'acquaintance')),
  last_called TIMESTAMPTZ,
  call_frequency TEXT NOT NULL CHECK (call_frequency IN ('weekly', 'biweekly', 'monthly')),
  platforms JSONB NOT NULL DEFAULT '[]'::jsonb,
  priority INTEGER NOT NULL DEFAULT 0,
  is_favorite BOOLEAN NOT NULL DEFAULT false,
  birthday DATE,
  anniversary DATE,
  snoozed_until TIMESTAMPTZ,
  custom_template TEXT,
  template_tone TEXT,
  instagram_username TEXT,
  snapchat_username TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_contacts_user_id ON contacts(user_id);

CREATE TABLE call_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  duration INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_call_notes_contact_id ON call_notes(contact_id);
CREATE INDEX idx_call_notes_user_id ON call_notes(user_id);

CREATE TABLE special_dates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  date DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_special_dates_contact_id ON special_dates(contact_id);

CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('planned_call', 'inactivity')),
  scheduled_for TIMESTAMPTZ NOT NULL,
  sent_at TIMESTAMPTZ,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_notifications_user ON notifications(user_id);
CREATE INDEX idx_notifications_scheduled_for ON notifications(scheduled_for);

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_contacts_updated_at
BEFORE UPDATE ON contacts
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_user_preferences_updated_at
BEFORE UPDATE ON user_preferences
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ─────────────────────────────────────────────────────────────────────────
-- OAuth authorization server (replaces Supabase Auth's OAuth-provider
-- feature that backed the MCP consent flow)
-- ─────────────────────────────────────────────────────────────────────────

-- Third-party apps (e.g. an MCP client) that can request access to a user's
-- data. Dynamically registered via POST /oauth/register.
CREATE TABLE oauth_clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id TEXT NOT NULL UNIQUE,
  client_secret_hash TEXT,            -- null for public clients (PKCE-only)
  client_name TEXT NOT NULL,
  redirect_uris TEXT[] NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Short-lived authorization codes issued after the user approves consent.
CREATE TABLE oauth_authorization_codes (
  code TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  redirect_uri TEXT NOT NULL,
  scope TEXT,
  code_challenge TEXT,
  code_challenge_method TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  used BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Access tokens are stored hashed so a DB leak doesn't hand out live tokens.
CREATE TABLE oauth_access_tokens (
  token_hash TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scope TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_oauth_access_tokens_user ON oauth_access_tokens(user_id);

CREATE TABLE oauth_refresh_tokens (
  token_hash TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scope TEXT,
  revoked BOOLEAN NOT NULL DEFAULT false,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
