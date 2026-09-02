import { Router } from 'express';
import { env } from '../env.js';
import { generateNotifications } from '../jobs/generateNotifications.js';

export const jobsRouter = Router();

/**
 * Externally-triggered run of the daily reminder job.
 *
 * Why this exists: the in-process `node-cron` schedule only fires if the
 * process is awake at that moment. Render's free tier spins an instance down
 * after ~15 minutes idle, so at 06:00 there is usually nothing running and
 * the job simply never happens — which looks exactly like "push notifications
 * are broken" while push is in fact fine.
 *
 * An external scheduler (GitHub Actions, cron-job.org, a Render Cron Job on
 * paid plans) hitting this endpoint both wakes the instance and runs the job.
 * See DEPLOYING.md for a ready-made GitHub Actions workflow.
 *
 * Auth is a shared secret rather than a user session, because the caller is a
 * machine with no cookies. Returns 503 rather than 401 when CRON_SECRET isn't
 * configured at all, so a misconfigured deploy is distinguishable from a
 * wrong secret.
 */
jobsRouter.post('/jobs/generate-notifications', async (req, res) => {
  if (!env.cronSecret) {
    return res.status(503).json({
      error: 'CRON_SECRET is not set on this server, so this endpoint is disabled.',
    });
  }

  const provided = req.get('x-cron-secret') ?? '';
  // Length-check first: timingSafeEqual throws on a length mismatch.
  if (provided.length !== env.cronSecret.length || provided !== env.cronSecret) {
    return res.status(401).json({ error: 'Invalid cron secret' });
  }

  try {
    const started = Date.now();
    const { created } = await generateNotifications();
    const ms = Date.now() - started;
    console.log(`[jobs] generate-notifications (external): created ${created} in ${ms}ms`);
    res.json({ ok: true, created, ms });
  } catch (err) {
    console.error('[jobs] generate-notifications failed:', err);
    res.status(500).json({ error: err.message });
  }
});
