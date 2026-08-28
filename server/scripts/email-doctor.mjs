#!/usr/bin/env node
/**
 * Email doctor — pinpoints why password-reset / verification mails aren't
 * arriving.
 *
 *   cd server
 *   npm run email-doctor                     # config + API checks
 *   npm run email-doctor -- you@gmail.com    # plus a real test send
 *
 * The auth routes swallow email errors on purpose (a dead mailer must not
 * block signup, and surfacing errors from /forgot-password would turn it into
 * an account-enumeration oracle), so the app UI reports success in every
 * failure mode. This script un-swallows them.
 */

// Dynamic import so a missing DATABASE_URL/JWT_SECRET produces a clear
// message instead of an unhandled module-load crash — those are unrelated to
// email, but env.js requires them.
let env, checkEmailConfig, parseFromAddress, FREE_MAIL_DOMAINS;
try {
  ({ env } = await import('../src/env.js'));
  ({ checkEmailConfig, parseFromAddress, FREE_MAIL_DOMAINS } = await import('../src/lib/email.js'));
} catch (err) {
  console.error(`\n\x1b[31mCould not load server config:\x1b[0m ${err.message}`);
  console.error(
    'This script reads server/.env. If that file is missing, copy it from server/.env.example ' +
      'and fill in at least DATABASE_URL and JWT_SECRET.\n'
  );
  process.exit(1);
}

const testRecipient = process.argv[2];

let failures = 0;
const ok = (m) => console.log(`  \x1b[32mPASS\x1b[0m  ${m}`);
const bad = (m, fix) => {
  failures++;
  console.log(`  \x1b[31mFAIL\x1b[0m  ${m}`);
  if (fix) console.log(`        \x1b[33m→ ${fix}\x1b[0m`);
};
const warn = (m) => console.log(`  \x1b[33mWARN\x1b[0m  ${m}`);
const section = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);

// ── 1. Local config ────────────────────────────────────────────────────
section('1. Local config (server/.env)');

const key = env.sendgridApiKey;
if (!key) {
  bad(
    'SENDGRID_API_KEY is not set — the server logs emails to the console instead of sending them.',
    'Set it in server/.env. The root .env is Vite-only and is never read by the backend.'
  );
} else {
  ok(`SENDGRID_API_KEY loaded (${key.length} chars, "${key.slice(0, 6)}…${key.slice(-4)}")`);
}

const from = parseFromAddress(env.emailFrom);
console.log(`  EMAIL_FROM raw:    ${JSON.stringify(env.emailFrom)}`);
console.log(`  EMAIL_FROM parsed: ${JSON.stringify(from)}`);

for (const p of checkEmailConfig()) {
  if (p.fatal) bad(p.message, p.fix);
  else warn(`${p.message}  → ${p.fix}`);
}

async function sg(pathname) {
  const res = await fetch(`https://api.sendgrid.com/v3${pathname}`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  const text = await res.text().catch(() => '');
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    /* leave undefined */
  }
  return { status: res.status, ok: res.ok, text, json };
}

if (key) {
  // ── 2. Key validity + scopes ─────────────────────────────────────────
  section('2. Key validity + permissions (GET /v3/scopes)');
  try {
    const r = await sg('/scopes');
    if (r.status === 401) {
      bad(
        'SendGrid returned 401 Unauthorized — the key is not valid.',
        'It was revoked, regenerated, or belongs to a different SendGrid account. Mint a fresh one.'
      );
    } else if (!r.ok) {
      bad(`SendGrid returned ${r.status}: ${r.text.slice(0, 300)}`);
    } else {
      const scopes = r.json?.scopes ?? [];
      ok(`Key is valid. ${scopes.length} scopes granted.`);
      if (scopes.includes('mail.send')) {
        ok('Scope "mail.send" is present.');
      } else {
        bad(
          'Scope "mail.send" is MISSING — this is the classic "my key is correct but nothing sends".',
          'You created a Restricted Access key without Mail Send enabled. SendGrid: ' +
            'Settings > API Keys > your key > Edit > enable Mail Send (or create a Full Access key).'
        );
      }
    }
  } catch (err) {
    bad(`Could not reach api.sendgrid.com: ${err.message}`, 'Check outbound network / firewall / proxy.');
  }

  // ── 3. Sender verification ───────────────────────────────────────────
  section('3. Sender verification (GET /v3/verified_senders)');
  try {
    const r = await sg('/verified_senders');
    if (r.status === 403) {
      warn('Key lacks permission to read verified senders — skipping (not itself a send blocker).');
    } else if (!r.ok) {
      warn(`Could not read verified senders (${r.status}). Verify manually in the dashboard.`);
    } else {
      const senders = r.json?.results ?? [];
      const verified = senders.filter((s) => s.verified);
      const pending = senders.filter((s) => !s.verified).map((s) => s.from_email);
      console.log(`  Verified: ${verified.map((s) => s.from_email).join(', ') || '(none)'}`);
      if (pending.length) warn(`Pending (unconfirmed): ${pending.join(', ')}`);

      const match = verified.find((s) => s.from_email.toLowerCase() === from.email.toLowerCase());
      if (match) {
        ok(`EMAIL_FROM (${from.email}) matches a verified sender.`);
      } else if (verified.length === 0 && pending.length === 0) {
        bad(
          'No Single Sender is verified on this account.',
          'Settings > Sender Authentication > Single Sender Verification. Add your address and click ' +
            'the confirmation link SendGrid emails you. Every send 403s until you do.'
        );
      } else {
        bad(
          `EMAIL_FROM (${from.email}) is NOT in the verified list.`,
          'Set EMAIL_FROM to one of the verified addresses above (exact match), or verify this one.'
        );
      }
    }
  } catch (err) {
    warn(`Verified-sender check failed: ${err.message}`);
  }

  // ── 4. Suppression lists ─────────────────────────────────────────────
  section('4. Suppression lists (is the recipient the problem?)');
  const lists = [
    ['/suppression/bounces', 'bounces'],
    ['/suppression/blocks', 'blocks'],
    ['/suppression/spam_reports', 'spam reports'],
    ['/suppression/invalid_emails', 'invalid addresses'],
  ];
  for (const [p, label] of lists) {
    try {
      const r = await sg(p);
      if (!r.ok) {
        warn(`Could not read ${label} (${r.status}).`);
        continue;
      }
      const entries = Array.isArray(r.json) ? r.json : [];
      if (entries.length === 0) {
        ok(`No ${label}.`);
      } else {
        const addrs = entries.map((e) => e.email);
        warn(`${entries.length} ${label}: ${addrs.slice(0, 10).join(', ')}`);
        if (testRecipient && addrs.some((a) => a.toLowerCase() === testRecipient.toLowerCase())) {
          bad(
            `${testRecipient} is on the ${label} list — SendGrid returns 202 and then silently drops the message.`,
            `Remove it: SendGrid > Suppressions > ${label}.`
          );
        }
      }
    } catch (err) {
      warn(`${label} check failed: ${err.message}`);
    }
  }
}

// ── 5. Real send, through the app's own code path ──────────────────────
if (key && testRecipient) {
  section(`5. Live test send to ${testRecipient}`);
  // Deliberately goes through sendEmail() rather than a hand-rolled fetch, so
  // this exercises the exact code the auth routes use.
  const { sendEmail } = await import('../src/lib/email.js');
  try {
    const result = await sendEmail({
      to: testRecipient,
      subject: 'Kall Konnect email doctor test',
      html:
        '<p>If you are reading this, the SendGrid path works and the problem is elsewhere ' +
        '(token issuance, route wiring, or spam filtering).</p>',
    });
    ok(`SendGrid accepted the message. ${result.messageId ? `x-message-id: ${result.messageId}` : ''}`);
    const fromDomain = from.email.split('@')[1]?.toLowerCase();
    const toDomain = testRecipient.split('@')[1]?.toLowerCase();
    console.log(
      '\n  A 202 means SendGrid queued it — NOT that it was delivered.\n' +
        `  Look up ${result.messageId ? `message ${result.messageId}` : 'the message'} in ` +
        'SendGrid > Activity Feed. What you see there tells you which problem you have:\n' +
        '    Delivered  → it arrived; check the spam/junk folder\n' +
        '    Blocked    → the receiving provider refused it (usually DMARC — see below)\n' +
        '    Dropped    → SendGrid suppressed it before sending (bounce/spam list)\n' +
        '    Deferred   → temporary; the receiver asked SendGrid to retry later'
    );
    if (FREE_MAIL_DOMAINS.has(fromDomain)) {
      console.log(
        `\n  \x1b[33mMost likely cause here:\x1b[0m you are sending FROM @${fromDomain}, which you don't\n` +
          `  control. ${fromDomain}'s DMARC record doesn't authorise SendGrid, so the message fails\n` +
          '  authentication and gets junked or refused. Authenticate a domain you own instead.'
      );
      if (fromDomain === toDomain) {
        console.log(
          `  Also: you sent from ${from.email} TO the same provider. Gmail treats mail that claims\n` +
            '  to be from one of its own users, but arrives from an outside server, as spoofing —\n' +
            '  so this is the single worst case to test with. Try a non-Gmail recipient too.'
        );
      }
    }
  } catch (err) {
    bad(err.message);
  }
} else if (key) {
  section('5. Live test send');
  console.log('  Skipped. To actually send:  npm run email-doctor -- you@gmail.com');
}

// ── 6. Link correctness (separate from delivery) ───────────────────────
section('6. Link target (APP_URL)');
console.log(`  Reset links will point at: ${env.appUrl}/reset-password?token=…`);
if (/^http:\/\/(\d+\.){3}\d+/.test(env.appUrl)) {
  warn(
    'APP_URL is a LAN IP (scripts/sync-lan-ip.mjs rewrites it on every npm start). ' +
      'Links only work on devices on that same network — opening the mail on mobile data will fail.'
  );
}
if (env.appUrl.includes(':5173')) {
  warn('APP_URL uses port 5173, but vite.config.ts serves on 8080. Links may 404.');
}

console.log(
  failures === 0
    ? '\n\x1b[32mNo blocking problems found in config.\x1b[0m Check the Activity Feed and spam folder next.\n'
    : `\n\x1b[31m${failures} blocking problem(s) found.\x1b[0m Fix the FAIL lines above and re-run.\n`
);
process.exit(failures === 0 ? 0 : 1);
