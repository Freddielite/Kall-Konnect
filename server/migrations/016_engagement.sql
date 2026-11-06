-- Schema for the engagement work (HANDOVER 2026-11-07):
--
-- notifications.opened_at / acted_at: whether a reminder was tapped, and
--   whether a call to that person was logged within 48 hours of it. The
--   only way to know if reminders work, and to tune the guesses in
--   reminderSignals.js against data. `npm run reminder-report` reads them.
-- notifications type 'streak_risk': the evening "keep your streak" nudge.
-- contacts.remind_next_on: set by "Remind me tomorrow" on a lock-screen
--   reminder; the job makes that contact the pick on that local date.
-- user_preferences.streak_risk_sent_on: the evening nudge's own once-a-day
--   marker (the morning job's reminders_processed_on is separate).
-- user_preferences.onboarded_at: set when the first-run flow finishes or is
--   skipped. Existing users are marked onboarded so they never see it.
-- job_heartbeats: last success/failure of background jobs, served by
--   GET /health/reminders for an external uptime monitor.
--
-- All ADD COLUMNs are nullable or constant-default: metadata-only, no
-- table rewrite or long lock.

ALTER TABLE notifications ADD COLUMN opened_at TIMESTAMPTZ;
ALTER TABLE notifications ADD COLUMN acted_at TIMESTAMPTZ;
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN (
    'planned_call', 'inactivity', 'occasion', 'follow_up', 'first_call', 'streak', 'nudge', 'streak_risk'
  ));

ALTER TABLE contacts ADD COLUMN remind_next_on DATE;

ALTER TABLE user_preferences ADD COLUMN streak_risk_sent_on DATE;
ALTER TABLE user_preferences ADD COLUMN onboarded_at TIMESTAMPTZ;
UPDATE user_preferences SET onboarded_at = now();

CREATE TABLE job_heartbeats (
  name TEXT PRIMARY KEY,
  last_success_at TIMESTAMPTZ,
  last_failure_at TIMESTAMPTZ,
  last_error TEXT
);
