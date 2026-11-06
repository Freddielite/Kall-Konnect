-- "Sign out everywhere", and refresh-token reuse detection.
--
-- session_version: carried in every access token as `sv`. Bumping it
--   invalidates every access token already issued, immediately — revoking
--   refresh tokens alone left stolen access tokens working for up to 15 min.
-- replaced_at: set when a refresh token is rotated (as opposed to revoked
--   by logout). If a replaced token is presented again well after
--   replacement, someone is replaying a stolen token, and every session for
--   that user is killed.
ALTER TABLE users ADD COLUMN session_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE refresh_tokens ADD COLUMN replaced_at TIMESTAMPTZ;
