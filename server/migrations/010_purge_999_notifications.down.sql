-- 010 only deleted broken rows; there is no schema to undo and the rows
-- are not worth restoring. Intentionally a no-op so rollbacks can pass it.
SELECT 1;
