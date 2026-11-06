-- Schema only. The duplicate notifications 005 deleted are gone for good;
-- a rollback cannot bring back rows, only restore from backup can.
DROP INDEX IF EXISTS idx_notifications_unread;
DROP INDEX IF EXISTS idx_notifications_user_contact_created;
