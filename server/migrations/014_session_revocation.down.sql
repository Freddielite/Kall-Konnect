ALTER TABLE refresh_tokens DROP COLUMN IF EXISTS replaced_at;
ALTER TABLE users DROP COLUMN IF EXISTS session_version;
