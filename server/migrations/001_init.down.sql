-- DESTROYS ALL APP DATA. Only for tearing down a dev/test database.
-- The migrator refuses to run this without --allow-data-loss.
DROP TABLE IF EXISTS oauth_refresh_tokens, oauth_access_tokens, oauth_authorization_codes,
  oauth_clients, notifications, special_dates, call_notes, contacts, user_preferences,
  refresh_tokens, users CASCADE;
DROP FUNCTION IF EXISTS update_updated_at_column() CASCADE;
