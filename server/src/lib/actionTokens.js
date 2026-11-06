import crypto from 'node:crypto';
import { env } from '../env.js';

/**
 * Signed, single-purpose tokens for buttons on a push notification.
 *
 * "Remind me tomorrow" runs in the service worker, from the lock screen,
 * without opening the app. It can't count on the login cookie being sent
 * (iOS blocks it cross-site) and must not carry a real session token in a
 * push payload. So each notification carries a token that can do exactly
 * one thing — act on that one notification — and expires.
 */
const TTL_MS = 7 * 24 * 3600_000;

function sign(payload) {
  return crypto.createHmac('sha256', `${env.jwtSecret}:notification-action`).update(payload).digest('base64url');
}

export function issueActionToken(notificationId, action, now = Date.now()) {
  const exp = Math.floor((now + TTL_MS) / 1000);
  return `${exp}.${sign(`${notificationId}|${action}|${exp}`)}`;
}

export function verifyActionToken(token, notificationId, action, now = Date.now()) {
  if (typeof token !== 'string' || token.length > 200) return false;
  const [expStr, sig] = token.split('.');
  const exp = Number(expStr);
  if (!Number.isInteger(exp) || !sig || exp * 1000 < now) return false;
  const expected = Buffer.from(sign(`${notificationId}|${action}|${exp}`));
  const given = Buffer.from(sig);
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}
