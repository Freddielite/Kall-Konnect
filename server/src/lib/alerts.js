import { env } from '../env.js';

/**
 * Posts an alert to ERROR_WEBHOOK_URL (a Slack or Discord incoming
 * webhook), so that "payments stopped" — here, "reminders stopped" — reaches
 * a person the same day instead of being found in the logs a week later.
 *
 * Throttled two ways, so a crash loop sends one message, not thousands:
 * the same `key` at most once per 15 minutes, and 20 alerts an hour overall.
 * Never throws: alerting must not be able to take down what it watches.
 */
const PER_KEY_MS = 15 * 60_000;
const HOURLY_CAP = 20;

const lastSentByKey = new Map();
let windowStart = 0;
let sentThisWindow = 0;

export function shouldSend(key, now = Date.now()) {
  if (now - windowStart > 3600_000) {
    windowStart = now;
    sentThisWindow = 0;
  }
  if (sentThisWindow >= HOURLY_CAP) return false;
  const last = lastSentByKey.get(key);
  if (last && now - last < PER_KEY_MS) return false;
  lastSentByKey.set(key, now);
  sentThisWindow += 1;
  return true;
}

/** Resets throttling state. Tests only. */
export function resetAlertThrottle() {
  lastSentByKey.clear();
  windowStart = 0;
  sentThisWindow = 0;
}

export async function alert(key, message) {
  if (!env.errorWebhookUrl || !shouldSend(key)) return;
  const text = `[Kall Konnect${env.isProduction ? '' : ' dev'}] ${message}`.slice(0, 1900);
  try {
    // `text` is Slack's field, `content` is Discord's; each ignores the other.
    await fetch(env.errorWebhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, content: text }),
      signal: AbortSignal.timeout(5000),
    });
  } catch (err) {
    console.error('[alerts] webhook failed:', err.message);
  }
}

/** Records a background job's outcome in job_heartbeats, for
 * GET /health/reminders. `query` is passed in to keep this file free of a
 * database import (and so usable from anywhere). */
export async function recordHeartbeat(query, name, error) {
  try {
    if (error) {
      await query(
        `INSERT INTO job_heartbeats (name, last_failure_at, last_error) VALUES ($1, now(), $2)
         ON CONFLICT (name) DO UPDATE SET last_failure_at = now(), last_error = $2`,
        [name, String(error.message ?? error).slice(0, 500)]
      );
    } else {
      await query(
        `INSERT INTO job_heartbeats (name, last_success_at) VALUES ($1, now())
         ON CONFLICT (name) DO UPDATE SET last_success_at = now()`,
        [name]
      );
    }
  } catch (err) {
    console.error('[heartbeat] could not record:', err.message);
  }
}
