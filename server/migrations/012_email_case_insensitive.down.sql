-- Emails already lowercased by the up migration stay lowercase; the
-- original casing was not recorded and isn't needed to sign in.
DROP INDEX IF EXISTS users_email_lower_idx;
DROP INDEX IF EXISTS users_email_lower_unique;
ALTER TABLE users DROP COLUMN IF EXISTS email_case_conflict;
