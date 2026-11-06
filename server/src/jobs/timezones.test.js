import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  calendarDaysBetween, hasReminderTimePassed, isRoutineDue, localDateKey, reminderMinuteOfDay, wallClock,
} from './reminderRules.js';

describe('the every-other-day bug', () => {
  // Yesterday's reminder is written a few seconds after the run starts, so
  // at the same minute today only 23h59m have passed. Counting whole
  // 24-hour periods called that "0 days" and skipped the day.
  test('a daily reminder is due again the next morning, seconds early', () => {
    assert.equal(isRoutineDue({
      lastRoutineAt: new Date('2026-11-05T06:00:05Z'),
      notificationFrequency: 'daily',
      now: new Date('2026-11-06T06:00:00Z'),
    }), true);
  });

  test('a weekly reminder is due on day 7, not day 8', () => {
    assert.equal(isRoutineDue({
      lastRoutineAt: new Date('2026-11-02T06:00:05Z'),
      notificationFrequency: 'weekly',
      now: new Date('2026-11-09T06:00:00Z'),
    }), true);
  });

  test('never twice on the same local day', () => {
    assert.equal(isRoutineDue({
      lastRoutineAt: new Date('2026-11-06T00:30:00Z'),
      notificationFrequency: 'daily',
      now: new Date('2026-11-06T22:45:00Z'),
      timeZone: 'Africa/Lagos', // 01:30 and 23:45 local, same date
    }), false);
  });
});

describe('local days', () => {
  test('midnight is the user\'s midnight, not UTC\'s', () => {
    // 22:00Z and 23:30Z are the same UTC day but 23:00 and 00:30 in Lagos.
    assert.equal(calendarDaysBetween('2026-11-06T22:00:00Z', '2026-11-06T23:30:00Z', 'UTC'), 0);
    assert.equal(calendarDaysBetween('2026-11-06T22:00:00Z', '2026-11-06T23:30:00Z', 'Africa/Lagos'), 1);
  });

  test('a daylight-saving change is still one day', () => {
    // US clocks fall back on 2026-11-01: that day is 25 hours long.
    assert.equal(calendarDaysBetween('2026-10-31T16:00:00Z', '2026-11-01T17:00:00Z', 'America/New_York'), 1);
  });

  test('localDateKey and wallClock read the user\'s clock', () => {
    const t = new Date('2026-11-06T23:30:00Z');
    assert.equal(localDateKey(t, 'Africa/Lagos'), '2026-11-07');
    assert.equal(localDateKey(t, 'America/Los_Angeles'), '2026-11-06');
    assert.equal(wallClock(t, 'Asia/Kolkata').getHours(), 5);
    assert.equal(wallClock(t, 'Asia/Kolkata').getMinutes(), 0);
  });
});

describe('reminder time', () => {
  test('preferred call time sets the start of the window', () => {
    assert.equal(reminderMinuteOfDay({ preferredCallTime: 'morning' }), 8 * 60);
    assert.equal(reminderMinuteOfDay({ preferredCallTime: 'afternoon' }), 12 * 60);
    assert.equal(reminderMinuteOfDay({ preferredCallTime: 'evening' }), 17 * 60);
  });

  test('"anytime" uses reminder_time, falling back to 09:00', () => {
    assert.equal(reminderMinuteOfDay({ preferredCallTime: 'anytime', reminderTime: '07:30' }), 7 * 60 + 30);
    assert.equal(reminderMinuteOfDay({ preferredCallTime: 'anytime', reminderTime: 'garbage' }), 9 * 60);
    assert.equal(reminderMinuteOfDay({ preferredCallTime: 'anytime', reminderTime: null }), 9 * 60);
  });

  test('the 9am reminder does not fire at 4am', () => {
    const at = (iso) => hasReminderTimePassed({
      now: new Date(iso), timeZone: 'America/New_York', preferredCallTime: 'anytime', reminderTime: '09:00',
    });
    assert.equal(at('2026-11-06T09:00:00Z'), false); // 04:00 in New York
    assert.equal(at('2026-11-06T13:59:00Z'), false); // 08:59
    assert.equal(at('2026-11-06T14:00:00Z'), true);  // 09:00
  });

  test('half-hour timezones are honoured', () => {
    const at = (iso) => hasReminderTimePassed({
      now: new Date(iso), timeZone: 'Asia/Kolkata', preferredCallTime: 'morning',
    });
    assert.equal(at('2026-11-06T02:15:00Z'), false); // 07:45 IST
    assert.equal(at('2026-11-06T02:30:00Z'), true);  // 08:00 IST
  });
});
