#!/usr/bin/env node
/**
 * Notifications doctor — shows exactly what the daily reminder job would do,
 * without waiting for the 06:00 cron.
 *
 *   cd server
 *   npm run notifications-doctor              # config checks + dry run
 *   npm run notifications-doctor -- --run     # actually create + push
 *   npm run notifications-doctor -- --reset you@example.com
 *
 * `--reset` deletes that user's notification rows, which clears the
 * per-contact cooldown so you can run the job again immediately instead of
 * waiting out a contact's call frequency. Test data only — it is a real
 * DELETE.
 */

let env, query, pool, generateNotifications, thresholdDaysFor, ROTATION_DAYS;
try {
  ({ env } = await import('../src/env.js'));
  ({ query, pool } = await import('../src/db.js'));
  ({ generateNotifications } = await import('../src/jobs/generateNotifications.js'));
  ({ thresholdDaysFor } = await import('../src/jobs/reminderRules.js'));
  ({ ROTATION_DAYS } = await import('../src/jobs/reminderSignals.js'));
} catch (err) {
  console.error(`\n\x1b[31mCould not load server config:\x1b[0m ${err.message}`);
  console.error(
    'This script reads server/.env. If that file is missing, copy it from ' +
      'server/.env.example and fill in at least DATABASE_URL and JWT_SECRET.\n'
  );
  process.exit(1);
}

const args = process.argv.slice(2);
const doRun = args.includes('--run');
const resetEmail = args.includes('--reset') ? args[args.indexOf('--reset') + 1] : null;

const ok = (m) => console.log(`  \x1b[32mPASS\x1b[0m  ${m}`);
const warn = (m, fix) => {
  console.log(`  \x1b[33mWARN\x1b[0m  ${m}`);
  if (fix) console.log(`        \x1b[33m→ ${fix}\x1b[0m`);
};
const bad = (m, fix) => {
  console.log(`  \x1b[31mFAIL\x1b[0m  ${m}`);
  if (fix) console.log(`        \x1b[33m→ ${fix}\x1b[0m`);
};
const head = (m) => console.log(`\n\x1b[1m${m}\x1b[0m`);

// ── --reset ───────────────────────────────────────────────────────────────
if (resetEmail) {
  head(`Resetting notification history for ${resetEmail}`);
  const { rows: users } = await query('SELECT id FROM users WHERE email = $1', [resetEmail]);
  if (!users[0]) {
    bad(`No user with email ${resetEmail}`);
    await pool.end();
    process.exit(1);
  }
  const { rowCount } = await query('DELETE FROM notifications WHERE user_id = $1', [users[0].id]);
  ok(`Deleted ${rowCount} notification row(s) — cooldowns cleared.`);
  await pool.end();
  process.exit(0);
}

// ── 1. Config ─────────────────────────────────────────────────────────────
head('1. Configuration');

try {
  await query('SELECT 1');
  ok('Database reachable.');
} catch (err) {
  bad(`Database unreachable: ${err.message}`, 'Check DATABASE_URL in server/.env, and that Postgres is running.');
  process.exit(1);
}

const { rows: mig } = await query(
  "SELECT 1 FROM information_schema.tables WHERE table_name = 'schema_migrations'"
);
if (mig.length === 0) {
  bad('No schema_migrations table.', 'Run: npm run migrate');
} else {
  for (const f of [
    '005_notification_dedupe.sql',
    '006_notification_scenarios.sql',
    '007_daily_nudge_type.sql',
    '008_quiet_day_nudges.sql',
    '009_notification_categories.sql',
    '010_purge_999_notifications.sql',
  ]) {
    const { rows: applied } = await query('SELECT 1 FROM schema_migrations WHERE filename = $1', [f]);
    if (applied.length) ok(`Migration ${f} applied.`);
    else bad(`Migration ${f} NOT applied.`, 'Run: npm run migrate');
  }
}

// Stale rows from before the fixes still show in the bell, which reads the
// last 20 notifications regardless of when they were written.
const { rows: [legacy] } = await query(
  "SELECT count(*)::int AS n FROM notifications WHERE message LIKE '%999 days%'"
);
if (legacy.n === 0) ok('No legacy "999 days" notifications left in the bell.');
else bad(`${legacy.n} legacy "999 days" notification(s) still stored.`, 'Run: npm run migrate (applies 010)');

if (env.vapidPublicKey && env.vapidPrivateKey) {
  ok('VAPID keys configured — push will be attempted.');
} else {
  warn(
    'VAPID keys not set — push is skipped, the in-app bell still works.',
    'Generate with: npx web-push generate-vapid-keys, then set VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY in server/.env'
  );
}

const { rows: [subs] } = await query('SELECT count(*)::int AS n FROM push_subscriptions');
if (subs.n > 0) ok(`${subs.n} push subscription(s) registered.`);
else warn('No push subscriptions.', 'Open the app, Settings > Enable Notifications, and allow the browser prompt.');

const { rows: [enabled] } = await query(
  'SELECT count(*)::int AS n FROM user_preferences WHERE notifications_enabled = true'
);
if (enabled.n > 0) ok(`${enabled.n} user(s) have notifications enabled.`);
else bad('No users have notifications_enabled = true.', 'The job will do nothing. Toggle it on in Settings.');

// ── 2. Dry run ────────────────────────────────────────────────────────────
head(doRun ? '2. Plan (about to be executed)' : '2. Dry run — what a real run would create');

const { plan } = await generateNotifications({ dryRun: true });

if (plan.length === 0) {
  console.log('  No users with notifications enabled.');
} else {
  for (const p of plan) {
    console.log(`\n  ${p.email}   greeting: ${p.userName ? `"Hey ${p.userName},"` : '(no name — greeting omitted)'}   streak: ${p.streak}d`);

    // Re-derive the per-contact reasoning so you can see WHY a contact was
    // or wasn't picked, not just the outcome.
    const { rows: contacts } = await query(
      `SELECT c.id, c.name, c.call_frequency, c.last_called, c.snoozed_until,
              (SELECT max(n.created_at) FROM notifications n
                WHERE n.user_id = c.user_id AND n.contact_id = c.id) AS last_notified_at
         FROM contacts c WHERE c.user_id = $1 ORDER BY c.name`,
      [p.userId]
    );
    if (contacts.length === 0) console.log('    (no contacts)');

    const picked = new Map(p.reminders.map((r) => [r.contactId, r]));
    const now = Date.now();
    const days = (d) => Math.floor((now - new Date(d).getTime()) / 86_400_000);
    for (const c of contacts) {
      const threshold = thresholdDaysFor(c.call_frequency);
      const since = c.last_called ? `${days(c.last_called)}d ago` : 'never called';
      let reason;
      const hit = picked.get(c.id);
      if (hit) {
        reason = `\x1b[32mWILL FIRE\x1b[0m  (${hit.type})`;
      } else if (c.snoozed_until && new Date(c.snoozed_until) > new Date()) {
        reason = `snoozed until ${new Date(c.snoozed_until).toISOString().slice(0, 10)}`;
      } else if (c.last_notified_at && days(c.last_notified_at) < ROTATION_DAYS) {
        reason = `named ${days(c.last_notified_at)}d ago — rotating past`;
      } else if (days(c.last_called ?? 0) >= threshold || !c.last_called) {
        reason = 'due, but another contact was picked today';
      } else {
        reason = `not due (threshold ${threshold}d)`;
      }
      console.log(`    ${c.name.padEnd(18)} ${c.call_frequency.padEnd(9)} ${since.padEnd(14)} ${reason}`);
      if (hit) console.log(`      \x1b[2m${hit.message}\x1b[0m`);
    }
  }
}

const total = plan.reduce((n, p) => n + p.reminders.length, 0);
console.log(`\n  ${total} notification(s) would be created — one per user per day.`);
for (const p of plan) {
  for (const r of p.reminders) console.log(`    ${p.email}  [${r.type}]  ${r.message}`);
}

// ── 3. Execute ────────────────────────────────────────────────────────────
if (doRun) {
  head('3. Executing for real');
  const { created } = await generateNotifications();
  ok(`Created ${created} notification(s).`);
  console.log(
    '\n  Check the app: the bell should update live (no refresh) if a tab is open,\n' +
      '  and a push should arrive if VAPID keys and a subscription are both present.'
  );
} else {
  console.log('\n  Nothing was written. Re-run with \x1b[1m--run\x1b[0m to execute.\n');
}

await pool.end();
