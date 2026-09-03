import crypto from 'node:crypto';
import webpush from 'web-push';
import { env } from '../env.js';
import { query } from '../db.js';

/** Re-derives the VAPID public key from the private one.
 *
 * VAPID keys are a P-256 keypair: the public key is the private scalar times
 * the curve generator, so a pair can be verified offline.
 *
 * This is the most destructive misconfiguration available and the hardest to
 * see. Two keys from two different `generate-vapid-keys` runs look equally
 * valid in a dashboard. The browser accepts ANY well-formed public key, so
 * subscribing succeeds and the row saves — then every send is signed with a
 * private key that doesn't correspond to it and gets rejected. The symptom is
 * "push is configured and nothing ever arrives".
 */
export function derivePublicKey(privateKeyBase64Url) {
  const ec = crypto.createECDH('prime256v1');
  ec.setPrivateKey(Buffer.from(privateKeyBase64Url, 'base64url'));
  return ec.getPublicKey().toString('base64url');
}

/** Config-only checks. Returns plain data so both the CLI script and the HTTP
 * endpoint can render it. Never returns key material beyond a short prefix. */
export function checkVapidConfig() {
  const checks = [];
  const add = (name, ok, detail, fix) => checks.push({ name, ok, detail, ...(fix ? { fix } : {}) });

  if (!env.vapidPublicKey || !env.vapidPrivateKey) {
    add('keys present', false, 'VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY are not both set.',
      'Generate with: npx web-push generate-vapid-keys — set BOTH from the SAME run.');
    return checks;
  }

  const pubBytes = Buffer.from(env.vapidPublicKey, 'base64url').length;
  const privBytes = Buffer.from(env.vapidPrivateKey, 'base64url').length;

  add('public key format', pubBytes === 65, `Public key is ${pubBytes} bytes (expected 65).`,
    pubBytes === 65 ? undefined : 'Truncated paste, or not a VAPID public key.');
  add('private key format', privBytes === 32, `Private key is ${privBytes} bytes (expected 32).`,
    privBytes === 32 ? undefined : 'Truncated paste, or not a VAPID private key.');

  if (pubBytes === 65 && privBytes === 32) {
    let derived = null;
    try {
      derived = derivePublicKey(env.vapidPrivateKey);
    } catch (err) {
      add('keypair match', false, `Private key could not be parsed: ${err.message}`);
    }
    if (derived !== null) {
      const matches = derived === env.vapidPublicKey;
      add(
        'keypair match',
        matches,
        matches
          ? 'Public and private keys are a MATCHING pair.'
          : `MISMATCHED. Public key set starts "${env.vapidPublicKey.slice(0, 20)}…" but the private key derives "${derived.slice(0, 20)}…".`,
        matches
          ? undefined
          : 'This alone breaks every send while subscribing still appears to work. Run `npx web-push generate-vapid-keys` ONCE, set both values from that single output, redeploy, then re-register every device.'
      );
    }
  }

  const subject = env.vapidSubject ?? '';
  const subjectOk = /^(mailto:\S+@\S+|https:\/\/\S+)$/.test(subject);
  add('subject', subjectOk, `VAPID_SUBJECT is "${subject}".`,
    subjectOk ? undefined : 'Must be a mailto: address or https: URL. Some push services reject sends otherwise.');

  for (const [name, value] of [
    ['VAPID_PUBLIC_KEY', process.env.VAPID_PUBLIC_KEY],
    ['VAPID_PRIVATE_KEY', process.env.VAPID_PRIVATE_KEY],
    ['CRON_SECRET', process.env.CRON_SECRET],
  ]) {
    if (value && value !== value.trim()) {
      add(`${name} whitespace`, false, `${name} has leading/trailing whitespace.`, 'Re-paste it without the stray newline.');
    }
  }

  return checks;
}

/** Lists registered devices. Returns push-service hostnames, never endpoints
 * or subscription secrets. */
export async function listDevices(email) {
  const { rows } = email
    ? await query(
        `SELECT s.id, s.endpoint, s.created_at, u.email FROM push_subscriptions s
           JOIN users u ON u.id = s.user_id WHERE u.email = $1 ORDER BY s.created_at DESC`,
        [email]
      )
    : await query(
        `SELECT s.id, s.endpoint, s.created_at, u.email FROM push_subscriptions s
           JOIN users u ON u.id = s.user_id ORDER BY s.created_at DESC`
      );

  return rows.map((r) => {
    let host = 'unknown';
    try { host = new URL(r.endpoint).host; } catch { /* ignore */ }
    return { id: r.id, email: r.email, pushService: host, addedAt: r.created_at };
  });
}

/** Sends a real push and reports the raw status code per device.
 *
 * The status code is the entire point: 403 means the signature was refused
 * (mismatched keys or a bad subject), 404/410 mean the endpoint is gone, 201
 * means delivery worked and any remaining problem is on the device's display
 * side. Everything else is guesswork. */
export async function liveSend(email) {
  if (!env.vapidPublicKey || !env.vapidPrivateKey) {
    return { error: 'VAPID keys are not configured.' };
  }
  webpush.setVapidDetails(env.vapidSubject, env.vapidPublicKey, env.vapidPrivateKey);

  const { rows } = await query(
    `SELECT s.id, s.endpoint, s.p256dh, s.auth FROM push_subscriptions s
       JOIN users u ON u.id = s.user_id WHERE u.email = $1`,
    [email]
  );
  if (rows.length === 0) return { error: `No subscriptions for ${email}.` };

  const results = [];
  for (const sub of rows) {
    let host = 'unknown';
    try { host = new URL(sub.endpoint).host; } catch { /* ignore */ }
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify({ title: 'Push doctor', body: 'This is a real push notification.', icon: '/icon-192.png' })
      );
      results.push({ pushService: host, status: 201, ok: true, meaning: 'Accepted. If nothing appeared, the problem is display, not delivery.' });
    } catch (err) {
      const status = err?.statusCode ?? 0;
      const meaning =
        status === 403 ? 'Signature refused — mismatched VAPID keys or an invalid subject.'
        : status === 404 || status === 410 ? 'Endpoint is dead. Re-register the device in Settings.'
        : status === 400 ? 'Malformed subscription or payload.'
        : 'Unexpected error from the push service.';
      results.push({ pushService: host, status, ok: false, meaning, body: String(err?.body ?? err?.message ?? '').slice(0, 300) });
    }
  }
  return { results };
}
