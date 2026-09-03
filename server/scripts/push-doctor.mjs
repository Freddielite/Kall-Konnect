#!/usr/bin/env node
/**
 * Push doctor — checks every layer that has to be right for a notification to
 * arrive, and says which one isn't.
 *
 *   cd server
 *   npm run push-doctor                        # config + subscription audit
 *   npm run push-doctor -- --send you@mail.com # real push, real status code
 *   npm run push-doctor -- --purge you@mail.com # drop that user's subscriptions
 *
 * Runs anywhere the server's env is available — including Render's Shell tab,
 * which is the fastest way to check production without a redeploy.
 */

let env, pool, checkVapidConfig, listDevices, liveSend, query;
try {
  ({ env } = await import('../src/env.js'));
  ({ query, pool } = await import('../src/db.js'));
  ({ checkVapidConfig, listDevices, liveSend } = await import('../src/lib/pushDoctor.js'));
} catch (err) {
  console.error(`\nCould not load server config: ${err.message}`);
  process.exit(1);
}

const args = process.argv.slice(2);
const sendTo = args.includes('--send') ? args[args.indexOf('--send') + 1] : null;
const purgeFor = args.includes('--purge') ? args[args.indexOf('--purge') + 1] : null;

const ok = (m) => console.log(`  \x1b[32mPASS\x1b[0m  ${m}`);
const bad = (m, fix) => {
  console.log(`  \x1b[31mFAIL\x1b[0m  ${m}`);
  if (fix) console.log(`        \x1b[33m→ ${fix}\x1b[0m`);
};
const warn = (m, fix) => {
  console.log(`  \x1b[33mWARN\x1b[0m  ${m}`);
  if (fix) console.log(`        \x1b[33m→ ${fix}\x1b[0m`);
};
const head = (m) => console.log(`\n\x1b[1m${m}\x1b[0m`);

head('1. VAPID keys');
for (const c of checkVapidConfig()) {
  if (c.ok) ok(c.detail);
  else bad(c.detail, c.fix);
}

head('2. Database');
try {
  await query('SELECT 1');
  ok('Database reachable.');
} catch (err) {
  bad(`Database unreachable: ${err.message}`);
  process.exit(1);
}

if (purgeFor) {
  const { rows: users } = await query('SELECT id FROM users WHERE email = $1', [purgeFor]);
  if (!users[0]) {
    bad(`No user with email ${purgeFor}`);
  } else {
    const { rowCount } = await query('DELETE FROM push_subscriptions WHERE user_id = $1', [users[0].id]);
    ok(`Deleted ${rowCount} subscription(s). That device must re-register in Settings.`);
  }
  await pool.end();
  process.exit(0);
}

head('3. Registered devices');
const devices = await listDevices();
if (devices.length === 0) {
  bad('No push subscriptions at all.', 'Open the app, Settings, Turn on reminders, and Allow the prompt.');
} else {
  ok(`${devices.length} subscription(s):`);
  for (const d of devices) {
    console.log(`        ${d.email}  via ${d.pushService}  (added ${new Date(d.addedAt).toISOString().slice(0, 16)})`);
  }
}

head('4. Live send');
if (!sendTo) {
  console.log('  Skipped. Re-run with --send you@example.com to send a real push and see the exact status code.');
} else {
  const { error, results } = await liveSend(sendTo);
  if (error) bad(error);
  for (const r of results ?? []) {
    if (r.ok) ok(`${r.pushService}: HTTP ${r.status}. ${r.meaning}`);
    else {
      bad(`${r.pushService}: HTTP ${r.status}. ${r.meaning}`);
      if (r.body) console.log(`        ${r.body}`);
    }
  }
}

console.log();
await pool.end();
