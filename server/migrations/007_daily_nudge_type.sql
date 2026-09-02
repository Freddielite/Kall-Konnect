-- Adds the 'nudge' notification type.
--
-- The job now sends exactly one routine reminder per user per day, naming
-- one person. On a day when nobody is due it still sends something — a
-- short encouragement with no contact attached — because the app's whole
-- purpose is a daily prompt, and a habit with holes in it isn't a habit.
--
-- Keep in sync with SCENARIO_TYPES in server/src/jobs/reminderCopy.js and
-- the icon map in src/components/NotificationsBell.tsx.

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN (
    'planned_call', 'inactivity', 'occasion', 'follow_up', 'first_call', 'streak', 'nudge'
  ));
