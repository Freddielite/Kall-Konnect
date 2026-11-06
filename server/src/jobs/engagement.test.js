import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { isStreakAtRisk, localDateKeyPlusDays, STREAK_RISK_MINUTE } from './reminderRules.js';
import { buildReminder } from './reminderCopy.js';

describe('evening streak nudge', () => {
  test('only for a real streak with no call yet today', () => {
    assert.equal(isStreakAtRisk({ streak: 3, calledToday: false }), true);
    assert.equal(isStreakAtRisk({ streak: 3, calledToday: true }), false);
    assert.equal(isStreakAtRisk({ streak: 1, calledToday: false }), false);
    assert.equal(isStreakAtRisk({ streak: 0, calledToday: false }), false);
  });

  test('due from 7pm', () => {
    assert.equal(STREAK_RISK_MINUTE, 19 * 60);
  });

  test('copy names the streak and never adds a second streak line', () => {
    const r = buildReminder('streak_risk', { streak: 6, userName: 'Freddie', dayKey: '2026-11-07' });
    assert.equal(r.type, 'streak_risk');
    assert.match(r.title, /6-day streak/);
    assert.match(r.message, /^Hey Freddie, /);
    assert.doesNotMatch(r.message, /day run\.$/);
  });
});

describe('"remind me tomorrow" dates', () => {
  test('tomorrow is the user\'s tomorrow', () => {
    // 23:30 UTC on the 6th is already the 7th in Lagos.
    const t = new Date('2026-11-06T23:30:00Z');
    assert.equal(localDateKeyPlusDays(t, 'Africa/Lagos', 1), '2026-11-08');
    assert.equal(localDateKeyPlusDays(t, 'America/New_York', 1), '2026-11-07');
  });

  test('month and year boundaries', () => {
    assert.equal(localDateKeyPlusDays(new Date('2026-12-31T12:00:00Z'), 'UTC', 1), '2027-01-01');
    assert.equal(localDateKeyPlusDays(new Date('2028-02-28T12:00:00Z'), 'UTC', 1), '2028-02-29');
  });
});
