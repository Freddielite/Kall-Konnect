import pg from 'pg';
import { env } from './env.js';

// pg's default parser turns DATE columns (OID 1082) into JS Date objects,
// which then serialize as full UTC timestamps ("1995-06-15T00:00:00.000Z")
// via res.json(). The frontend's parseLocalDate() expects a bare
// "YYYY-MM-DD" string, matching what Supabase's PostgREST used to return
// for date columns — so keep dates as raw strings here instead.
pg.types.setTypeParser(1082, (value) => value);

/**
 * Managed Postgres (Render, Heroku, Supabase, Neon) terminates TLS with a
 * certificate signed by the provider's own CA, which isn't in Node's trust
 * store. `pg` then rejects the connection with SELF_SIGNED_CERT_IN_CHAIN
 * and the app looks like it can't reach the database at all.
 *
 * Only relaxes verification when the connection string actually asks for
 * SSL, so a local `postgres://localhost/...` is untouched. Set
 * `DATABASE_SSL_STRICT=true` to keep full verification if you've supplied
 * the provider's CA via NODE_EXTRA_CA_CERTS.
 *
 * On Render, prefer the *internal* database URL: same private network, no
 * SSL needed, no egress cost.
 */
function resolveSsl(connectionString) {
  const wantsSsl = /[?&]ssl(mode)?=(require|true|verify-full|verify-ca)/i.test(connectionString ?? '');
  if (!wantsSsl) return undefined;
  if (process.env.DATABASE_SSL_STRICT === 'true') return true;
  return { rejectUnauthorized: false };
}

export const pool = new pg.Pool({
  connectionString: env.databaseUrl,
  ssl: resolveSsl(env.databaseUrl),
  // Without these, a maxed-out connection pool (stale connections left open
  // by earlier crashed/killed dev-server restarts, or an unreachable DB)
  // makes pool.query() hang forever with no error — which from the
  // frontend just looks like a dead request until its own client-side
  // timeout kills it. Fail fast instead so the real problem surfaces in
  // this server's logs.
  max: 10,
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 30000,
});

pool.on('error', (err) => {
  console.error('[db] unexpected pool error:', err.message);
});

/** Tagged helper: query('select * from contacts where user_id = $1', [userId]) */
export async function query(text, params) {
  return pool.query(text, params);
}

export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
