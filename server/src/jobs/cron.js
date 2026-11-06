import cron from 'node-cron';
import { generateNotifications } from './generateNotifications.js';
import { generateStreakRiskNudges } from './streakRisk.js';
import { alert, recordHeartbeat } from '../lib/alerts.js';
import { purgeDeletedContacts } from '../routes/contacts.js';
import { query } from '../db.js';
import { env } from '../env.js';

/** Every 15 minutes, so a user whose reminder time is 17:00 — or 17:00 in
 * a half-hour timezone like India's — hears from us within 15 minutes of
 * it. Each run only does real work for users who've just become due; see
 * generateNotifications. */
export const REMINDER_SCHEDULE = '*/15 * * * *';

/**
 * Everything one reminder tick does: the morning-style reminders and the
 * evening streak check, plus the heartbeat that GET /health/reminders
 * reports and an alert if it fails. Shared by the in-process schedule and
 * the external trigger (routes/jobs.js), so both behave identically.
 * Rethrows after recording, so callers can report the failure too.
 */
export async function runReminderTick(source) {
  try {
    const { created } = await generateNotifications();
    const { created: nudges } = await generateStreakRiskNudges();
    await recordHeartbeat(query, 'reminders');
    return { created, nudges };
  } catch (err) {
    await recordHeartbeat(query, 'reminders', err);
    await alert('reminders-failed', `Reminder job failed (${source}): ${err.message}`);
    throw err;
  }
}

let running = false;
async function run(source) {
  // A slow run must not overlap the next tick in the same process.
  if (running) return;
  running = true;
  try {
    const { created, nudges } = await runReminderTick(source);
    if (created + nudges > 0 || source !== 'scheduled') {
      console.log(`[cron] reminders (${source}): created ${created} reminder(s), ${nudges} streak nudge(s)`);
    }
  } catch (err) {
    console.error(`[cron] reminders (${source}) failed:`, err);
  } finally {
    running = false;
  }
}

/** Daily housekeeping: hard-delete contacts past their restore window,
 * and expired login/reset tokens, which otherwise accumulate forever. */
export async function runHousekeeping() {
  const contacts = await purgeDeletedContacts();
  const { rowCount: refresh } = await query(
    "DELETE FROM refresh_tokens WHERE expires_at < now() - interval '7 days'"
  );
  const { rowCount: oneTime } = await query(
    "DELETE FROM auth_tokens WHERE expires_at < now() - interval '7 days'"
  );
  console.log(`[cron] housekeeping: purged ${contacts} contact(s), ${refresh} refresh token(s), ${oneTime} one-time token(s)`);
}

export function startCronJobs() {
  // node-cron fires only if this process is awake at the scheduled minute.
  // That's fine on an always-on instance, or a free one kept warm by a
  // pinger. It is NOT fine on a host that sleeps when idle — Render's free
  // tier spins down after ~15 min — where the job would simply never run.
  // POST /jobs/generate-notifications covers that case; see DEPLOYING.md §1b.
  if (!env.cronSecret && process.env.NODE_ENV === 'production') {
    console.warn(
      '[cron] CRON_SECRET is not set, so reminders depend entirely on this ' +
        'process being awake. Fine if the instance is always-on or kept warm ' +
        'by a pinger; if it sleeps when idle, reminders will not be sent. ' +
        'See DEPLOYING.md §1b.'
    );
  }
  if (process.env.CRON_SCHEDULE) {
    console.warn(
      `[cron] CRON_SCHEDULE=${process.env.CRON_SCHEDULE} is ignored: reminders now go out at ` +
        "each user's own reminder time, checked every 15 minutes. Remove it from the environment."
    );
  }

  console.log(`[cron] reminders checked ${REMINDER_SCHEDULE} (UTC); each user is reminded at their own local time`);
  cron.schedule(REMINDER_SCHEDULE, () => run('scheduled'), { timezone: 'UTC' });

  cron.schedule('30 3 * * *', () => {
    runHousekeeping().catch((err) => console.error('[cron] housekeeping failed:', err));
  }, { timezone: 'UTC' });

  // Catch-up on boot: a restart or redeploy can straddle a tick. Safe to run
  // unconditionally — users already processed today are skipped.
  if (env.cronCatchUpOnBoot) {
    setTimeout(() => void run('catch-up on boot'), 10_000).unref?.();
  }
}
