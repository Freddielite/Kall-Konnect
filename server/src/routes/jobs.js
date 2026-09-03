import { Router } from 'express';
import crypto from 'node:crypto';
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

  if (!secretsMatch(req.get('x-cron-secret') ?? '', env.cronSecret)) {
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

/** Constant-time comparison. A plain !== leaks timing proportional to the
 * length of the matching prefix, which is enough to recover a secret byte by
 * byte given enough attempts. timingSafeEqual throws on a length mismatch, so
 * the lengths are compared first — and that comparison is itself safe, since
 * the length of a random secret isn't the sensitive part. */
function secretsMatch(provided, expected) {
  if (typeof provided !== 'string' || typeof expected !== 'string') return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * Pinger-friendly trigger, ported from the focus-tracker reference.
 *
 * The POST endpoint above needs a custom header, which most free schedulers
 * either can't send or bury behind an advanced tab. This one is a plain GET
 * with the secret in the query string, so anything that can fetch a URL on a
 * timer works: cron-job.org, UptimeRobot, a phone shortcut.
 *
 * Meant to be called EVERY FEW MINUTES, not once a day. That difference is
 * the point. A daily single shot has to succeed on its only attempt, and a
 * sleeping free instance or a scheduler hiccup silently costs a whole day of
 * reminders. Frequent ticks keep the instance warm and make any individual
 * failure irrelevant, because another follows shortly. generateNotifications
 * is idempotent for the day, so the extra calls cost a query and return
 * created: 0.
 *
 * The secret does end up in the URL, and therefore in access logs — a real
 * tradeoff versus the header version, which stays available for callers that
 * can send one. It gates a job that writes reminders, not user data, and
 * rotating it is a one-line env change.
 */
jobsRouter.get('/jobs/tick', async (req, res) => {
  if (!env.cronSecret) {
    return res.status(503).json({ error: 'CRON_SECRET is not set on this server.' });
  }

  const provided = req.get('x-cron-secret') || req.query.secret;
  if (!secretsMatch(provided, env.cronSecret)) {
    return res.status(401).json({ error: 'Invalid cron secret' });
  }

  try {
    const started = Date.now();
    const { created } = await generateNotifications();
    const ms = Date.now() - started;
    // Only log ticks that did something. At one call every five minutes this
    // would otherwise bury every other log line under 288 no-ops a day.
    if (created > 0) {
      console.log(`[jobs] tick: created ${created} notification(s) in ${ms}ms`);
    }
    res.json({ ok: true, created, ms });
  } catch (err) {
    console.error('[jobs] tick failed:', err);
    res.status(500).json({ error: err.message });
  }
});
