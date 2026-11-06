-- Emails become case-insensitive.
--
-- Before this, `users.email` was compared byte-for-byte, so Alice@x.com and
-- alice@x.com could register as two separate accounts, and ALICE@x.com
-- could log in to neither.
--
-- Existing duplicates (same address, different case or stray whitespace)
-- can't be merged automatically: each may hold contacts and notes, and only
-- a human can say which account the person actually uses. So they are
-- flagged, not touched. Every flagged account keeps its stored email and
-- can still sign in (login tries each match). Everyone else is normalized
-- to lowercase. List and merge the flagged ones with:
--   npm run email-conflicts
--   npm run merge-accounts -- --keep <id> --remove <id>
--
-- Locking: ADD COLUMN with a constant default is metadata-only on PG 11+;
-- the UPDATEs touch only rows that change. Fine for a users table of this
-- size; on a very large table, batch the UPDATE.

ALTER TABLE users ADD COLUMN email_case_conflict BOOLEAN NOT NULL DEFAULT false;

UPDATE users SET email_case_conflict = true
 WHERE lower(btrim(email)) IN (
   SELECT lower(btrim(email)) FROM users GROUP BY lower(btrim(email)) HAVING count(*) > 1
 );

UPDATE users SET email = lower(btrim(email))
 WHERE NOT email_case_conflict AND email <> lower(btrim(email));

-- Enforces uniqueness for every non-conflicting account, including any
-- registration racing another for the same address.
CREATE UNIQUE INDEX users_email_lower_unique ON users (lower(email)) WHERE NOT email_case_conflict;
-- The partial index above can't serve plain `lower(email) = $1` lookups.
CREATE INDEX users_email_lower_idx ON users (lower(email));
