-- Purge the legacy "999 days" notifications.
--
-- Before the 2026-09-02 fixes, a contact with last_called = NULL had that
-- null coerced to 999, producing "It's been 999 days since your last call
-- with Freddie Ose. Stay connected!" — wrong number, wrong field, nonsense
-- sentence. No code path can generate that any more (never-called contacts
-- now count from contacts.created_at), but rows already written keep showing
-- in the bell, which reads the last 20 notifications regardless of age.
--
-- Migration 005's cleanup did NOT catch these. It de-duplicates per
-- (user_id, contact_id, type) and keeps the newest of each group — and the
-- old job emitted one 'planned_call' AND one 'inactivity' for the same
-- contact, so each was the sole survivor of its own group and both stayed.
--
-- Scope is deliberately narrow. Rather than matching the message text alone,
-- this also requires the contact to still have no logged call, which is what
-- proves the row is the bug rather than a genuine ~2.7-year gap. Orphaned
-- rows (contact since deleted, contact_id SET NULL) are covered separately.
--
-- Nothing is lost: these contacts are still never-called, so the next job run
-- regenerates a correct reminder for them.

DELETE FROM notifications n
USING contacts c
WHERE n.contact_id = c.id
  AND c.last_called IS NULL
  AND n.message LIKE '%999 days%';

DELETE FROM notifications
WHERE contact_id IS NULL
  AND message LIKE '%999 days%';
