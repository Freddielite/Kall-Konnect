import cron from 'node-cron';
import { generateNotifications } from './generateNotifications.js';

export function startCronJobs() {
  // Daily at 06:00 server time — same schedule as the old pg_cron job.
  cron.schedule('0 6 * * *', async () => {
    try {
      const { created } = await generateNotifications();
      console.log(`[cron] generate-notifications: created ${created} notification(s)`);
    } catch (err) {
      console.error('[cron] generate-notifications failed:', err);
    }
  });
}
