-- Dynamic reminder scenarios.
--
-- notifications.type used to allow only 'planned_call' and 'inactivity'.
-- The job now picks one of six scenarios per contact, each with its own
-- copy, so the CHECK constraint has to widen. These values are mirrored in
-- server/src/jobs/reminderCopy.js (SCENARIO_TYPES) and in the icon map in
-- src/components/NotificationsBell.tsx — change all three together.
--
--   planned_call  contact is past their call frequency
--   inactivity    contact is past the user's inactivity_days threshold
--   occasion      birthday / anniversary / special_dates entry is imminent
--   follow_up     last call note matched a learned "needs picking back up" signal
--   first_call    contact has never been called
--   streak        the user hit a calling-streak milestone (contact_id is NULL)

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('planned_call', 'inactivity', 'occasion', 'follow_up', 'first_call', 'streak'));

-- The job looks up "did I already send an occasion reminder for this
-- contact" and "did a streak notification go out today" on every run.
CREATE INDEX IF NOT EXISTS idx_notifications_user_type_created
  ON notifications (user_id, type, created_at DESC);
