import cron from 'node-cron';
import { generateNotifications } from './generateNotifications.js';
import { env } from '../env.js';

async function run(source) {
  try {
    const { created } = await generateNotifications();
    console.log(`[cron] generate-notifications (${source}): created ${created} notification(s)`);
  } catch (err) {
    console.error(`[cron] generate-notifications (${source}) failed:`, err);
  }
}

export function startCronJobs() {
  // node-cron fires only if this process is awake at the scheduled minute.
  // That's fine on an always-on instance, or a free one kept warm by a
  // pinger. It is NOT fine on a host that sleeps when idle — Render's free
  // tier spins down after ~15 min — where the job would simply never run.
  // POST /jobs/generate-notifications covers that case; see DEPLOYING.md §1b.
  if (!env.cronSecret && process.env.NODE_ENV === 'production') {
    console.warn(
      '[cron] CRON_SECRET is not set, so the daily reminder depends entirely on ' +
        'this process being awake at the scheduled time. Fine if the instance is ' +
        'always-on or kept warm by a pinger; if it sleeps when idle, reminders will ' +
        'not be sent. See DEPLOYING.md §1b.'
    );
  }

  // Server time is UTC on most hosts (Render included), so '0 6 * * *' would
  // reach a Nigerian user at 07:00 local. CRON_TIMEZONE fixes that without
  // touching the expression — set it to e.g. Africa/Lagos.
  const options = env.cronTimezone ? { timezone: env.cronTimezone } : undefined;
  console.log(
    `[cron] daily reminders scheduled at ${env.cronSchedule} (${env.cronTimezone || 'server time'})`
  );

  cron.schedule(env.cronSchedule, () => run('scheduled'), options);

  // Catch-up on boot.
  //
  // A restart or redeploy that straddles the scheduled minute means the tick
  // is missed and no reminder goes out that day — node-cron has no concept of
  // a missed run. This is the main residual risk once the instance is kept
  // awake, because deploys and platform restarts still happen.
  //
  // Safe to run unconditionally: generateNotifications is idempotent for the
  // day (isRoutineDue gates on the last notification's timestamp), so if
  // today's reminder already went out this does nothing at all.
  if (env.cronCatchUpOnBoot) {
    setTimeout(() => void run('catch-up on boot'), 10_000).unref?.();
  }
}
