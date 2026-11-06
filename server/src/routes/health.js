import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { query } from '../db.js';
import { alert } from '../lib/alerts.js';

export const healthRouter = Router();

/** How stale the last successful reminder run may be before it's an
 * outage. The server ticks every 15 minutes while awake, and the GitHub
 * workflow wakes it hourly, so 2 hours means both have failed. */
const REMINDERS_MAX_AGE_MS = 2 * 3600_000;

/**
 * For an external uptime monitor (UptimeRobot, Better Stack...): 200 while
 * reminders are running, 503 when they've silently stopped — the failure
 * the app is most exposed to, since nothing errors when a job just doesn't
 * run. Also proves the database is reachable. See DEPLOYING.md §10.
 */
healthRouter.get('/health/reminders', async (req, res) => {
  let row;
  try {
    ({ rows: [row] } = await query(
      "SELECT last_success_at, last_failure_at, last_error FROM job_heartbeats WHERE name = 'reminders'"
    ));
  } catch {
    return res.status(503).json({ ok: false, reason: 'database unreachable' });
  }
  const last = row?.last_success_at ? new Date(row.last_success_at) : null;
  const ageMs = last ? Date.now() - last.getTime() : null;
  const ok = ageMs !== null && ageMs <= REMINDERS_MAX_AGE_MS;
  res.status(ok ? 200 : 503).json({
    ok,
    lastSuccessAt: last?.toISOString() ?? null,
    minutesSinceSuccess: ageMs === null ? null : Math.round(ageMs / 60_000),
    lastFailureAt: row?.last_failure_at ?? null,
    // The message only: it's written by our own code, never user input.
    lastError: row?.last_error ?? null,
  });
});

const clientErrorLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => res.status(204).end(),
});

const clip = (v, n) => (typeof v === 'string' ? v.slice(0, n) : undefined);

/**
 * Uncaught errors from users' browsers (src/lib/errorReporting.ts), logged
 * and forwarded to ERROR_WEBHOOK_URL. Public, since errors can happen
 * before sign-in; rate-limited and truncated, since anyone can call it.
 * Always 204: the browser has nothing useful to do with a failure here.
 */
healthRouter.post('/client-errors', clientErrorLimiter, (req, res) => {
  const b = req.body ?? {};
  const report = {
    message: clip(b.message, 500) ?? '(no message)',
    stack: clip(b.stack, 3000),
    path: clip(b.path, 300),
    release: clip(b.release, 50),
    userAgent: clip(req.get('user-agent'), 300),
  };
  console.warn('[client-error]', JSON.stringify(report));
  void alert(`client:${report.message.slice(0, 120)}`, `Browser error on ${report.path ?? '?'}: ${report.message}`);
  res.status(204).end();
});
