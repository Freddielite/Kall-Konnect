import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldSend, resetAlertThrottle } from './alerts.js';

test('the same alert is sent at most once per 15 minutes', () => {
  resetAlertThrottle();
  const t = 1_000_000_000;
  assert.equal(shouldSend('a', t), true);
  assert.equal(shouldSend('a', t + 60_000), false);
  assert.equal(shouldSend('a', t + 16 * 60_000), true);
});

test('no more than 20 alerts an hour in total', () => {
  resetAlertThrottle();
  const t = 2_000_000_000;
  let sent = 0;
  for (let i = 0; i < 50; i++) if (shouldSend(`k${i}`, t + i)) sent++;
  assert.equal(sent, 20);
});
