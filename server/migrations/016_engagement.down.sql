DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM notifications WHERE type = 'streak_risk') THEN
    RAISE EXCEPTION 'streak_risk notifications exist; delete them first to roll back past 016';
  END IF;
END $$;
DROP TABLE IF EXISTS job_heartbeats;
ALTER TABLE user_preferences DROP COLUMN IF EXISTS onboarded_at;
ALTER TABLE user_preferences DROP COLUMN IF EXISTS streak_risk_sent_on;
ALTER TABLE contacts DROP COLUMN IF EXISTS remind_next_on;
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('planned_call', 'inactivity', 'occasion', 'follow_up', 'first_call', 'streak', 'nudge'));
ALTER TABLE notifications DROP COLUMN IF EXISTS acted_at;
ALTER TABLE notifications DROP COLUMN IF EXISTS opened_at;
