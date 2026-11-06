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
    // e.g. 001_init.sql. Excludes supabase-cutover.sql on purpose, and the
    // NNN_name.down.sql rollback files, which only `migrate:down` runs.
    .filter((f) => /^\d+.*\.sql$/.test(f) && !f.endsWith('.down.sql'))
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
/** Down migrations that drop user data wholesale. Running one needs
 * --allow-data-loss, so a mistyped --steps can't wipe production. */
const DATA_LOSS_DOWNS = new Set(['001_init.down.sql', '002_push_subscriptions.down.sql']);

/**
 * Rolls back the most recently applied migrations, newest first, using
 * each one's NNN_name.down.sql. Each step runs in its own transaction and
 * stops at the first failure, leaving the database at the last good step.
 * A migration with no down file cannot be rolled back past.
 */
export async function rollbackMigrations({ steps = 1, allowDataLoss = false } = {}) {
  const { rows } = await pool.query(
    'SELECT filename FROM schema_migrations ORDER BY filename DESC LIMIT $1',
    [steps]
  );
  if (rows.length === 0) {
    console.log('[migrate:down] nothing applied, nothing to roll back.');
    return;
  }
  for (const { filename } of rows) {
    const downFile = filename.replace(/\.sql$/, '.down.sql');
    const downPath = path.join(migrationsDir, downFile);
    if (!fs.existsSync(downPath)) throw new Error(`No ${downFile}; cannot roll back ${filename}.`);
    if (DATA_LOSS_DOWNS.has(downFile) && !allowDataLoss) {
      throw new Error(`${downFile} destroys data. Re-run with --allow-data-loss if you really mean it.`);
    }
    console.log(`[migrate:down] reverting ${filename}`);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(fs.readFileSync(downPath, 'utf8'));
      await client.query('DELETE FROM schema_migrations WHERE filename = $1', [filename]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
  console.log(`[migrate:down] reverted ${rows.length} migration${rows.length === 1 ? '' : 's'}.`);
}

// CLI entrypoints: `npm run migrate` and `npm run migrate:down [-- --steps N]`.
const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const stepsArg = args.indexOf('--steps');
  const task = args.includes('down')
    ? rollbackMigrations({
        steps: stepsArg >= 0 ? Math.max(1, parseInt(args[stepsArg + 1], 10) || 1) : 1,
        allowDataLoss: args.includes('--allow-data-loss'),
      })
    : runMigrations();
  task
    .then(() => pool.end())
    .catch((err) => {
      console.error('Migration failed:', err.message || err);
      process.exit(1);
    });
}
