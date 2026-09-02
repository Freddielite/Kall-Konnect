-- Toggle for the "nobody's due today" encouragement note.
--
-- The daily job sends one reminder naming one person. On a day when nobody
-- is actually due it still sends a short note, so the daily rhythm the app
-- is building doesn't have holes in it. Not everyone will want that, and
-- shipping behaviour with no way to turn it off is how a settings screen
-- starts lying to people.
--
-- Defaults to true to match the behaviour shipped in 007.

ALTER TABLE user_preferences
  ADD COLUMN IF NOT EXISTS quiet_day_nudges BOOLEAN NOT NULL DEFAULT true;
