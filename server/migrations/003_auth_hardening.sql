-- Kall Konnect: auth hardening.
--   - email_verified: tracks whether a user has confirmed their email.
--     Google/Apple accounts are provider-verified, so we mark them true
--     immediately; existing accounts are backfilled true below so nobody
--     already using the app gets locked out of anything (login is never
--     gated on this — it just drives the "verify your email" banner).
--   - auth_tokens: single table for both password-reset and
--     email-verification one-time tokens. We store a hash, never the raw
--     token (same pattern as refresh_tokens).

ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT false;

UPDATE users SET email_verified = true
WHERE google_sub IS NOT NULL OR apple_sub IS NOT NULL;

CREATE TABLE IF NOT EXISTS auth_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  purpose TEXT NOT NULL CHECK (purpose IN ('password_reset', 'email_verification')),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_auth_tokens_user ON auth_tokens(user_id);
