-- Adds a "called_at" timestamp to call_notes, separate from created_at.
--
-- created_at is (and remains) strictly when the row was inserted. That's
-- fine for calls logged live through the app's Call/WhatsApp buttons - the
-- note is saved right after the call happens, so "logged" and "happened"
-- are the same moment.
--
-- It breaks for the new "Log a call" flow (a call made outside the app,
-- e.g. the native dialer), where the user picks the actual date/time it
-- happened in a custom picker, which can be earlier than now. called_at
-- carries that chosen moment through to the learning engine
-- (lib/callTiming, lib/callLength, lib/streaks, frequencyFit), which all
-- key off CallNote.date - so a backdated manual log feeds them exactly
-- like a real one instead of skewing everything to "now".
--
-- Defaults to now() so every existing call flow (in-app calls, the MCP
-- add_call_note tool) keeps working unchanged without sending the new
-- field. Existing rows are backfilled from created_at, the closest known
-- truth for calls logged before this column existed.

ALTER TABLE call_notes ADD COLUMN called_at TIMESTAMPTZ;
UPDATE call_notes SET called_at = created_at WHERE called_at IS NULL;
ALTER TABLE call_notes ALTER COLUMN called_at SET DEFAULT now();
ALTER TABLE call_notes ALTER COLUMN called_at SET NOT NULL;

CREATE INDEX idx_call_notes_called_at ON call_notes(contact_id, called_at);
