// Merges one account into another: everything the removed account owns
// (contacts, call notes, special dates, notifications, push devices) moves
// to the kept account, then the removed account is deleted. Its sessions,
// login tokens and preferences are discarded; the kept account's are used.
// Built for the case-duplicate accounts listed by `npm run email-conflicts`.
//
// Usage:
//   npm run merge-accounts -- --keep <id> --remove <id>         preview only
//   npm run merge-accounts -- --keep <id> --remove <id> --yes   merge
//
// Runs in one transaction: it either all happens or none of it does.
// Tables are discovered from the foreign keys pointing at users, so a table
// added later is moved too rather than silently dropped by the cascade.

const { query, pool, withTransaction } = await import('../src/db.js');

const args = process.argv.slice(2);
const arg = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const keepId = arg('--keep');
const removeId = arg('--remove');
const execute = args.includes('--yes');

if (!keepId || !removeId || keepId === removeId) {
  console.error('Usage: npm run merge-accounts -- --keep <id> --remove <id> [--yes]');
  process.exit(1);
}

// Credentials and per-user settings: discarded with the removed account,
// never merged (moving a session token would sign the kept account in on
// the other account's devices).
const DISCARD = new Set([
  'refresh_tokens', 'auth_tokens', 'oauth_authorization_codes', 'oauth_access_tokens',
  'oauth_refresh_tokens', 'user_preferences',
]);

const { rows: users } = await query(
  'SELECT id, email, google_sub, google_calendar_refresh_token, email_verified FROM users WHERE id = ANY($1::uuid[])',
  [[keepId, removeId]]
);
const keep = users.find((u) => u.id === keepId);
const remove = users.find((u) => u.id === removeId);
if (!keep || !remove) {
  console.error('Both ids must be existing users.');
  process.exit(1);
}
if (keep.email.trim().toLowerCase() !== remove.email.trim().toLowerCase()) {
  console.error(`These accounts have different addresses (${keep.email} / ${remove.email}). Refusing to merge.`);
  process.exit(1);
}

const { rows: refs } = await query(`
  SELECT c.conrelid::regclass::text AS tbl, a.attname AS col
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
   WHERE c.contype = 'f' AND c.confrelid = 'users'::regclass`);

console.log(`Keep   ${keep.id}  ${keep.email}`);
console.log(`Remove ${remove.id}  ${remove.email}\n`);
const moves = [];
for (const { tbl, col } of refs) {
  const { rows } = await query(`SELECT count(*)::int AS n FROM ${tbl} WHERE ${col} = $1`, [removeId]);
  const action = DISCARD.has(tbl) ? 'discard' : 'move';
  if (action === 'move') moves.push({ tbl, col });
  console.log(`  ${tbl.padEnd(28)} ${String(rows[0].n).padStart(5)} row(s)  ${action}`);
}
const moveGoogle = !keep.google_sub && remove.google_sub;
const moveCalendar = !keep.google_calendar_refresh_token && remove.google_calendar_refresh_token;
if (moveGoogle) console.log('  Google sign-in link             move');
if (moveCalendar) console.log('  Google Calendar connection      move');

if (!execute) {
  console.log('\nPreview only. Re-run with --yes to merge.');
  await pool.end();
  process.exit(0);
}

await withTransaction(async (db) => {
  for (const { tbl, col } of moves) {
    await db.query(`UPDATE ${tbl} SET ${col} = $1 WHERE ${col} = $2`, [keepId, removeId]);
  }
  if (moveGoogle || moveCalendar) {
    const { rows } = await db.query(
      `SELECT google_sub, google_calendar_refresh_token, google_calendar_connected_at, google_calendar_email
         FROM users WHERE id = $1`,
      [removeId]
    );
    // Clear first: google_sub is UNIQUE.
    await db.query(
      `UPDATE users SET google_sub = CASE WHEN $2 THEN NULL ELSE google_sub END,
                        google_calendar_refresh_token = CASE WHEN $3 THEN NULL ELSE google_calendar_refresh_token END
        WHERE id = $1`,
      [removeId, Boolean(moveGoogle), Boolean(moveCalendar)]
    );
    if (moveGoogle) await db.query('UPDATE users SET google_sub = $2 WHERE id = $1', [keepId, rows[0].google_sub]);
    if (moveCalendar) {
      await db.query(
        `UPDATE users SET google_calendar_refresh_token = $2, google_calendar_connected_at = $3, google_calendar_email = $4
          WHERE id = $1`,
        [keepId, rows[0].google_calendar_refresh_token, rows[0].google_calendar_connected_at, rows[0].google_calendar_email]
      );
    }
  }
  if (remove.email_verified) await db.query('UPDATE users SET email_verified = true WHERE id = $1', [keepId]);
  await db.query('DELETE FROM users WHERE id = $1', [removeId]);

  // If that was the last duplicate, the kept account becomes an ordinary
  // lowercase account under the unique index.
  const { rows: left } = await db.query(
    'SELECT count(*)::int AS n FROM users WHERE lower(btrim(email)) = lower(btrim($1))',
    [keep.email]
  );
  if (left[0].n === 1) {
    await db.query(
      'UPDATE users SET email = lower(btrim(email)), email_case_conflict = false WHERE id = $1',
      [keepId]
    );
  }
});
console.log('\nMerged. The removed account\'s devices are signed out; the person signs in with the kept account\'s password.');
await pool.end();
