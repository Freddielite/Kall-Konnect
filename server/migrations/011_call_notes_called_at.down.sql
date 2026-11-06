DROP INDEX IF EXISTS idx_call_notes_called_at;
ALTER TABLE call_notes DROP COLUMN IF EXISTS called_at;
