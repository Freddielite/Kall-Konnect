DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM notifications WHERE type = 'nudge') THEN
    RAISE EXCEPTION 'nudge notifications exist; delete them first to roll back past 007';
  END IF;
END $$;
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('planned_call', 'inactivity', 'occasion', 'follow_up', 'first_call', 'streak'));
