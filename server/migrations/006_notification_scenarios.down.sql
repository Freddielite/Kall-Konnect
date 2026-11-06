-- The old constraint only allowed two types. Refuse rather than silently
-- delete notifications of the newer types.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM notifications WHERE type NOT IN ('planned_call', 'inactivity')) THEN
    RAISE EXCEPTION 'notifications of types added in 006 exist; delete them first to roll back past 006';
  END IF;
END $$;
DROP INDEX IF EXISTS idx_notifications_user_type_created;
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('planned_call', 'inactivity'));
