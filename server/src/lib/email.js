import { env } from '../env.js';

const PLACEHOLDER_FROM = /@example\.com$/i;

/** Domains whose owners publish DMARC policies you can never satisfy, because
 * you don't control their DNS. SendGrid will happily accept and even report
 * "delivered" — the receiving provider is what junks or drops the message. */
export const FREE_MAIL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.uk', 'ymail.com',
  'hotmail.com', 'hotmail.co.uk', 'outlook.com', 'live.com', 'msn.com',
  'aol.com', 'icloud.com', 'me.com', 'mac.com', 'proton.me', 'protonmail.com',
  'gmx.com', 'gmx.net', 'mail.com', 'zoho.com', 'yandex.com',
]);

/** Parses "Display Name <email@x.com>" (or a bare email) into SendGrid's
 * separate name/email fields. */
export function parseFromAddress(raw) {
  const match = raw.match(/^\s*(.*?)\s*<(.+)>\s*$/);
  if (match) {
    // Strip surrounding quotes from the display name — `EMAIL_FROM="App" <a@b.com>`
    // otherwise shows literal quote marks in the recipient's inbox.
    const name = match[1].replace(/^"(.*)"$/, '$1');
    return { name: name || undefined, email: match[2].trim() };
  }
  return { email: raw.trim() };
}

/**
 * Inspects the email config without sending anything. Returns a list of
 * problems, each with a `fatal` flag (fatal = sends are guaranteed to fail).
 * Used by the startup preflight in index.js and by scripts/email-doctor.mjs.
 */
export function checkEmailConfig() {
  const problems = [];
  const key = env.sendgridApiKey;

  if (!key) {
    problems.push({
      fatal: false,
      message: 'SENDGRID_API_KEY is not set — emails will be logged to this console instead of sent.',
      fix: 'Set it in server/.env (NOT the root .env, which is Vite-only and never read by the backend).',
    });
    // Nothing else matters if we're in dev mode.
    return problems;
  }

  if (!key.startsWith('SG.')) {
    problems.push({
      fatal: true,
      message: 'SENDGRID_API_KEY does not start with "SG." — that is not a SendGrid API key.',
      fix: 'You may have pasted a SendGrid account password or a key from another service.',
    });
  }
  if (/\s/.test(key)) {
    problems.push({
      fatal: true,
      message: 'SENDGRID_API_KEY contains an internal space or newline (it was line-wrapped on paste).',
      fix: 'Put the key on one unbroken line in server/.env.',
    });
  }

  const from = parseFromAddress(env.emailFrom);
  if (PLACEHOLDER_FROM.test(from.email)) {
    problems.push({
      fatal: true,
      message: `EMAIL_FROM is still the placeholder address (${from.email}). SendGrid will reject every send with 403.`,
      fix: 'Set EMAIL_FROM to the address you verified under Settings > Sender Authentication > Single Sender Verification.',
    });
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(from.email)) {
    problems.push({
      fatal: true,
      message: `EMAIL_FROM parses to "${from.email}", which is not a valid email address.`,
      fix: 'Use either "you@domain.com" or "Display Name <you@domain.com>".',
    });
    return problems;
  }

  const domain = from.email.split('@')[1]?.toLowerCase();
  if (FREE_MAIL_DOMAINS.has(domain)) {
    // Not fatal: SendGrid accepts these with a 202, so nothing here can detect
    // it at send time. That is exactly what makes it so confusing — the API
    // reports success and the mail is junked downstream by the recipient's
    // provider, which looks identical to "not sending at all".
    problems.push({
      fatal: false,
      message:
        `EMAIL_FROM uses ${domain}, a domain you don't control. ${domain} publishes SPF/DKIM/DMARC ` +
        'records that don\'t include SendGrid, so every message fails DMARC alignment and gets ' +
        'spam-foldered or dropped by the recipient\'s provider. SendGrid still returns 202, so ' +
        'sends look successful while nothing reaches the inbox.',
      fix:
        'Use a domain you own. In SendGrid: Settings > Sender Authentication > Authenticate Your ' +
        'Domain, add the CNAME records it gives you to your DNS, then set ' +
        'EMAIL_FROM="Kall Konnect <noreply@yourdomain.com>". Single Sender Verification is NOT ' +
        'enough here — it proves you own the inbox, not the domain.',
    });
  }

  return problems;
}

/** Turns a SendGrid HTTP failure into an error that says what to actually do
 * about it, instead of just echoing a status code. */
function explainSendGridFailure(status, body) {
  let detail = body;
  try {
    const parsed = JSON.parse(body);
    if (Array.isArray(parsed?.errors)) {
      detail = parsed.errors.map((e) => [e.field, e.message].filter(Boolean).join(': ')).join(' | ');
    }
  } catch {
    /* keep the raw body */
  }

  const hints = {
    401:
      'The API key is invalid — revoked, regenerated, or from a different SendGrid account. ' +
      'Mint a fresh one at Settings > API Keys.',
    403:
      'Almost always one of two things: (a) the API key lacks the "Mail Send" scope — a Restricted ' +
      'Access key without it authenticates fine but cannot send; or (b) EMAIL_FROM ' +
      `(currently "${env.emailFrom}") does not exactly match a verified Single Sender. ` +
      'Run `npm run email-doctor` to find out which.',
    413: 'The message (probably an .ics attachment) exceeds SendGrid\'s size limit.',
    429: 'Rate limited — the free tier allows 100 emails/day.',
  };

  const hint = hints[status] ?? 'Check the SendGrid Activity Feed for this message.';
  return new Error(`SendGrid rejected the send (HTTP ${status}): ${detail}\n  → ${hint}`);
}

const RETRYABLE = new Set([429, 500, 502, 503, 504]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Sends an email via SendGrid's v3 API (no SDK needed — Node 22 has global
 * fetch). If SENDGRID_API_KEY isn't set, logs the email to the console
 * instead of sending, so nothing blocks on it in dev — password reset and
 * verification links are still usable, just from the server log.
 *
 * attachments (optional): [{ filename, content }] where content is a raw
 * string (e.g. .ics text) — base64-encoded here before it goes to SendGrid.
 *
 * Throws on failure with an actionable message. Callers decide whether to
 * surface that or swallow it (see routes/auth.js).
 */
export async function sendEmail({ to, subject, html, attachments }) {
  if (!env.sendgridApiKey) {
    // Loud and skimmable: in dev this log IS the delivery mechanism, so any
    // link inside it needs to be easy to spot in a noisy terminal.
    const links = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
    console.log(
      [
        '',
        '┌─ EMAIL (dev mode — SENDGRID_API_KEY not set, nothing was actually sent)',
        `│  to:      ${to}`,
        `│  subject: ${subject}`,
        ...(links.length ? ['│', ...links.map((l) => `│  link:    ${l}`)] : []),
        '└─',
        '',
      ].join('\n')
    );
    return { devMode: true };
  }

  const fatal = checkEmailConfig().filter((p) => p.fatal);
  if (fatal.length) {
    throw new Error(
      `Email is misconfigured, refusing to send:\n${fatal
        .map((p) => `  - ${p.message}\n    → ${p.fix}`)
        .join('\n')}`
    );
  }

  const from = parseFromAddress(env.emailFrom);
  const payload = {
    personalizations: [{ to: [{ email: to }] }],
    from,
    subject,
    content: [{ type: 'text/html', value: html }],
    ...(attachments?.length
      ? {
          attachments: attachments.map((a) => ({
            filename: a.filename,
            type: 'text/calendar',
            disposition: 'attachment',
            content: Buffer.from(a.content).toString('base64'),
          })),
        }
      : {}),
  };

  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    let res;
    try {
      res = await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.sendgridApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      // Network-level failure (DNS, timeout, firewall). Worth retrying.
      lastError = new Error(`Could not reach api.sendgrid.com: ${err.message}`);
      if (attempt < 3) {
        await sleep(attempt * 500);
        continue;
      }
      throw lastError;
    }

    // SendGrid returns 202 with an empty body on success.
    if (res.ok) {
      return { ok: true, messageId: res.headers.get('x-message-id') ?? undefined };
    }

    const body = await res.text().catch(() => '');
    lastError = explainSendGridFailure(res.status, body);

    // 401/403 are configuration problems — retrying just wastes time.
    if (!RETRYABLE.has(res.status) || attempt === 3) throw lastError;
    await sleep(attempt * 500);
  }

  throw lastError;
}

export function sendPasswordResetEmail(to, resetUrl) {
  return sendEmail({
    to,
    subject: 'Reset your Kall Konnect password',
    html: `
      <p>Someone requested a password reset for your Kall Konnect account.</p>
      <p><a href="${resetUrl}">Click here to set a new password</a>. This link expires in 1 hour.</p>
      <p>If you didn't request this, you can safely ignore this email.</p>
    `,
  });
}

export function sendVerificationEmail(to, verifyUrl) {
  return sendEmail({
    to,
    subject: 'Verify your Kall Konnect email',
    html: `
      <p>Welcome to Kall Konnect! Please confirm your email address.</p>
      <p><a href="${verifyUrl}">Click here to verify your email</a>. This link expires in 24 hours.</p>
    `,
  });
}

export function sendCalendarReminderEmail(to, { subject, icsContent, icsFilename, bodyHtml }) {
  return sendEmail({
    to,
    subject,
    html: bodyHtml,
    attachments: [{ filename: icsFilename, content: icsContent }],
  });
}
