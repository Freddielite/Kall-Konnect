import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(__dirname, '..', 'migrations');

/**
 * Applies every pending migration in server/migrations/ (numbered .sql
 * files not yet recorded in schema_migrations), in order. Safe to call on
 * every server boot - already-applied files are skipped, and there's
 * nothing to do on a normal restart. Does NOT close the pool, since the
 * server keeps using it afterwards; the CLI entrypoint below does that
 * itself when run standalone.
 */
export async function runMigrations() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  const files = fs.readdirSync(migrationsDir)
    .filter((f) => /^\d+.*\.sql$/.test(f)) // e.g. 001_init.sql — excludes supabase-cutover.sql on purpose
    .sort();
  const { rows: applied } = await pool.query('SELECT filename FROM schema_migrations');
  const appliedSet = new Set(applied.map((r) => r.filename));

  const pending = files.filter((f) => !appliedSet.has(f));
  if (pending.length === 0) {
    console.log('[migrate] up to date, nothing to apply.');
    return;
  }

  for (const file of files) {
    if (appliedSet.has(file)) continue;
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    console.log(`[migrate] applying ${file}`);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  console.log(`[migrate] applied ${pending.length} migration${pending.length === 1 ? '' : 's'}. Up to date.`);
}

// CLI entrypoint (`npm run migrate`) - still works standalone for local use
// or a manual run, on top of the automatic run in index.js on every boot.
const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  runMigrations()
    .then(() => pool.end())
    .catch((err) => {
      console.error('Migration failed:', err);
      process.exit(1);
    });
}
