-- Per-category notification switches.
--
-- Users can now turn each kind of reminder on or off independently in
-- Settings. Stored as JSONB rather than six columns so adding a seventh
-- category later doesn't need another migration.
--
-- Keys match notifications.type / SCENARIO_TYPES in reminderCopy.js.
-- Missing keys are treated as enabled, so an older row (or a category added
-- in future) defaults to on rather than silently going quiet.

ALTER TABLE user_preferences
  ADD COLUMN IF NOT EXISTS notification_categories JSONB NOT NULL DEFAULT '{
    "planned_call": true,
    "inactivity": true,
    "occasion": true,
    "follow_up": true,
    "first_call": true,
    "streak": true
  }'::jsonb;
