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

import crypto from 'node:crypto';

let env, query, pool, webpush;
try {
  ({ env } = await import('../src/env.js'));
  ({ query, pool } = await import('../src/db.js'));
  webpush = (await import('web-push')).default;
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

/** Re-derives the public key from the private one.
 *
 * VAPID keys are a P-256 keypair: the public key is just the private scalar
 * multiplied by the curve's generator point, so the pair can be checked
 * offline with no network and no guessing.
 *
 * This is the single most destructive misconfiguration available, and the
 * hardest to spot. Two keys from two different `generate-vapid-keys` runs
 * look equally valid in a dashboard. The browser accepts ANY well-formed
 * public key, so subscribing succeeds and the row saves — then every send is
 * signed with a private key that doesn't correspond to it, and the push
 * service rejects all of them. The symptom is "push is set up and nothing
 * ever arrives", with nothing in the config obviously wrong.
 */
function derivePublicKey(privateKeyBase64Url) {
  const ec = crypto.createECDH('prime256v1');
  ec.setPrivateKey(Buffer.from(privateKeyBase64Url, 'base64url'));
  return ec.getPublicKey().toString('base64url');
}

head('1. VAPID keys');

if (!env.vapidPublicKey || !env.vapidPrivateKey) {
  bad(
    'VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY are not both set.',
    'Generate a pair with: npx web-push generate-vapid-keys — and set BOTH from the SAME run.'
  );
} else {
  // Length is a cheap sanity check before the real one: a truncated paste is
  // common and produces confusing downstream errors.
  const pubBytes = Buffer.from(env.vapidPublicKey, 'base64url').length;
  const privBytes = Buffer.from(env.vapidPrivateKey, 'base64url').length;

  if (pubBytes !== 65) bad(`Public key is ${pubBytes} bytes, expected 65.`, 'It was truncated or is not a VAPID public key.');
  else ok('Public key is a well-formed 65-byte P-256 point.');

  if (privBytes !== 32) bad(`Private key is ${privBytes} bytes, expected 32.`, 'It was truncated or is not a VAPID private key.');
  else ok('Private key is a well-formed 32-byte scalar.');

  if (pubBytes === 65 && privBytes === 32) {
    let derived = null;
    try {
      derived = derivePublicKey(env.vapidPrivateKey);
    } catch (err) {
      bad(`Private key could not be parsed: ${err.message}`);
    }
    if (derived !== null) {
      if (derived === env.vapidPublicKey) {
        ok('Public and private keys are a MATCHING pair.');
      } else {
        bad(
          'Public and private keys are from DIFFERENT keypairs.',
          'This alone breaks every send while subscribing still appears to work. ' +
            'Run `npx web-push generate-vapid-keys` ONCE, set both values from that ' +
            'single output, redeploy, then have every device re-register.'
        );
        console.log(`        public key set:      ${env.vapidPublicKey.slice(0, 24)}…`);
        console.log(`        derived from private: ${derived.slice(0, 24)}…`);
      }
    }
  }
}

const subject = env.vapidSubject ?? '';
if (/^(mailto:\S+@\S+|https:\/\/\S+)$/.test(subject)) {
  ok(`VAPID subject looks valid (${subject}).`);
} else {
  bad(
    `VAPID_SUBJECT is "${subject}", which is not a mailto: address or https: URL.`,
    'Some push services reject sends outright over this. Set e.g. mailto:you@example.com'
  );
}

// Whitespace survives dotenv and dashboard pastes, and breaks signatures in
// ways that read as "the key is wrong".
for (const [name, value] of [
  ['VAPID_PUBLIC_KEY', process.env.VAPID_PUBLIC_KEY],
  ['VAPID_PRIVATE_KEY', process.env.VAPID_PRIVATE_KEY],
  ['CRON_SECRET', process.env.CRON_SECRET],
]) {
  if (value && value !== value.trim()) {
    warn(`${name} has leading/trailing whitespace in the environment.`, 'Handled in code now, but worth cleaning up at the source.');
  }
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
const { rows: subs } = await query(
  `SELECT s.id, s.endpoint, s.created_at, u.email
     FROM push_subscriptions s JOIN users u ON u.id = s.user_id
    ORDER BY s.created_at DESC`
);

if (subs.length === 0) {
  bad('No push subscriptions at all.', 'Open the app, Settings, Turn on reminders, and Allow the prompt.');
} else {
  ok(`${subs.length} subscription(s):`);
  for (const s of subs) {
    let host = 'unknown';
    try { host = new URL(s.endpoint).host; } catch { /* ignore */ }
    console.log(`        ${s.email}  via ${host}  (added ${new Date(s.created_at).toISOString().slice(0, 16)})`);
  }
}

head('4. Live send');
if (!sendTo) {
  console.log('  Skipped. Re-run with --send you@example.com to send a real push and see the exact status code.');
} else if (!env.vapidPublicKey || !env.vapidPrivateKey) {
  bad('Cannot send without VAPID keys.');
} else {
  webpush.setVapidDetails(env.vapidSubject, env.vapidPublicKey, env.vapidPrivateKey);
  const targets = subs.filter((s) => s.email === sendTo);
  if (targets.length === 0) {
    bad(`No subscriptions for ${sendTo}.`);
  }
  for (const s of targets) {
    let host = 'unknown';
    try { host = new URL(s.endpoint).host; } catch { /* ignore */ }
    const { rows: [full] } = await query('SELECT p256dh, auth FROM push_subscriptions WHERE id = $1', [s.id]);
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: full.p256dh, auth: full.auth } },
        JSON.stringify({ title: 'Push doctor', body: 'This is a real push notification.', icon: '/icon-192.png' })
      );
      ok(`Accepted by ${host}. If nothing appeared on the device, the problem is display, not delivery.`);
    } catch (err) {
      // The status code is the whole point of this script: 403 means the
      // signature was refused (mismatched keys or bad subject), 404/410 mean
      // the endpoint is gone, 400 usually means a malformed subscription.
      bad(`${host} rejected the send: HTTP ${err.statusCode}`);
      if (err.body) console.log(`        ${String(err.body).trim().slice(0, 300)}`);
      if (err.statusCode === 403) {
        console.log('        \x1b[33m→ 403 means the VAPID signature was refused. Check section 1 above.\x1b[0m');
      }
      if (err.statusCode === 404 || err.statusCode === 410) {
        console.log('        \x1b[33m→ Endpoint is dead. Re-register the device (Settings > Re-register).\x1b[0m');
      }
    }
  }
}

console.log();
await pool.end();
