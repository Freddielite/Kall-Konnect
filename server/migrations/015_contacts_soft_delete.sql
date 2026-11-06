-- Soft delete for contacts, so "I deleted Mum by accident" is an undo, not
-- data loss. A deleted contact keeps its notes and special dates and is
-- hidden everywhere; it can be restored for 30 days, after which the
-- nightly purge removes it (and, via ON DELETE CASCADE, its notes).
--
-- The second index serves the paginated contact list (newest first, with
-- id as a tiebreaker for keyset pagination).
ALTER TABLE contacts ADD COLUMN deleted_at TIMESTAMPTZ;
CREATE INDEX idx_contacts_user_live ON contacts (user_id, created_at DESC, id DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_contacts_deleted_at ON contacts (deleted_at) WHERE deleted_at IS NOT NULL;
