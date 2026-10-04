import { env } from '../env.js';

const RETRYABLE = new Set([429, 500, 502, 503, 504]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Sends one transactional email through Wynmail (Wyntek's own in-house
 * sender) via `POST /v1/emails`. Used for password-reset and
 * email-verification links only — Wynmail's v1 API has no attachment
 * support, so the calendar-reminder .ics invites stay on SendGrid
 * (see sendEmail in lib/email.js).
 *
 * If WYNMAIL_API_KEY isn't set, logs the email to the console instead of
 * sending, so nothing blocks on it in dev — same fallback SendGrid uses.
 *
 * Throws on failure with Wynmail's own error message, which is already
 * written to say what to fix (unapproved sender, blocked address, daily
 * cap, etc) — see POST /emails in wynmail's server/src/routes/v1.js.
 */
export async function sendTransactionalEmail({ to, subject, html }) {
  if (!env.wynmailApiKey || !env.wynmailApiUrl) {
    const links = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
    console.log(
      [
        '',
        '┌─ EMAIL (dev mode — WYNMAIL_API_URL/WYNMAIL_API_KEY not set, nothing was actually sent)',
        `│  to:      ${to}`,
        `│  subject: ${subject}`,
        ...(links.length ? ['│', ...links.map((l) => `│  link:    ${l}`)] : []),
        '└─',
        '',
      ].join('\n')
    );
    return { devMode: true };
  }

  const url = `${env.wynmailApiUrl.replace(/\/+$/, '')}/v1/emails`;
  const payload = { to, subject, html };

  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.wynmailApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      // Network-level failure (DNS, timeout, firewall). Worth retrying.
      lastError = new Error(`Could not reach Wynmail (${url}): ${err.message}`);
      if (attempt < 3) {
        await sleep(attempt * 500);
        continue;
      }
      throw lastError;
    }

    const body = await res.json().catch(() => ({}));

    if (res.ok) {
      return { ok: true, messageId: body.provider_id ?? body.id ?? undefined };
    }

    lastError = new Error(`Wynmail rejected the send (HTTP ${res.status}): ${body.error ?? 'Unknown error'}`);

    // 401 (bad key) and 400/422 (unapproved sender, blocked address) are
    // configuration/data problems — retrying just wastes time.
    if (!RETRYABLE.has(res.status) || attempt === 3) throw lastError;
    await sleep(attempt * 500);
  }

  throw lastError;
}
