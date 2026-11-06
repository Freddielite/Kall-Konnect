-- Restores the old semantics: anything soft-deleted is deleted for real
-- first, since without the column it would silently reappear.
DELETE FROM contacts WHERE deleted_at IS NOT NULL;
DROP INDEX IF EXISTS idx_contacts_deleted_at;
DROP INDEX IF EXISTS idx_contacts_user_live;
ALTER TABLE contacts DROP COLUMN IF EXISTS deleted_at;
