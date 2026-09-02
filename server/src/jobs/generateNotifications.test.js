// Unit tests for the reminder decision logic. No database, no network —
// these exercise the pure helpers only, so `npm test` runs anywhere in
// well under a second.
//
//   cd server && npm test
//
// The DB-dependent half of the job is covered by `npm run notifications-doctor`,
// which dry-runs it against real data.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { cooldownDaysFor, daysBetween, isRoutineDue, periodDaysFor } from './reminderRules.js';

describe('cooldownDaysFor', () => {
  test('matches the contact call frequency', () => {
    assert.equal(cooldownDaysFor(7), 7);    // weekly
    assert.equal(cooldownDaysFor(14), 14);  // biweekly
    assert.equal(cooldownDaysFor(30), 30);  // monthly
  });

  test('never drops below 2 days', () => {
    assert.equal(cooldownDaysFor(1), 2);
    assert.equal(cooldownDaysFor(0), 2);
  });
});

describe('daysBetween', () => {
  test('floors to whole days', () => {
    const a = new Date('2026-01-01T00:00:00Z');
    assert.equal(daysBetween(a, new Date('2026-01-08T00:00:00Z')), 7);
    assert.equal(daysBetween(a, new Date('2026-01-08T23:59:00Z')), 7);
    assert.equal(daysBetween(a, new Date('2026-01-09T00:00:00Z')), 8);
  });
});


// ── Dynamic scenario copy ─────────────────────────────────────────────────

import { chooseScenario, FOLLOW_UP_MIN_DAYS } from './reminderRules.js';
import {
  buildReminder, greetingName, toneForContact, variantIndex, SCENARIO_TYPES,
} from './reminderCopy.js';
import {
  computeCallStreak, isStreakMilestone, upcomingOccasionFor,
  buildFollowUpVocabulary, matchFollowUpSignal, parseDateOnly,
  urgencyScore, pickDailyContact, ROTATION_DAYS, averageIntervalFor,
} from './reminderSignals.js';

describe('greetingName', () => {
  test('uses the first word of display_name', () => {
    assert.equal(greetingName({ displayName: 'Joy Okafor', email: 'x@y.com' }), 'Joy');
    assert.equal(greetingName({ displayName: 'joy', email: 'x@y.com' }), 'Joy');
    assert.equal(greetingName({ displayName: 'JOY OKAFOR' }), 'Joy');
  });

  test('falls back to the email local part', () => {
    // display_name is nullable and never required at signup.
    assert.equal(greetingName({ email: 'joy.okafor@example.com' }), 'Joy');
    assert.equal(greetingName({ email: 'joy_okafor@example.com' }), 'Joy');
    assert.equal(greetingName({ email: 'joy23@example.com' }), 'Joy');
    assert.equal(greetingName({ displayName: '   ', email: 'joy@example.com' }), 'Joy');
  });

  test('returns null rather than something embarrassing', () => {
    assert.equal(greetingName({ email: 'info@example.com' }), null);
    assert.equal(greetingName({ email: 'noreply@example.com' }), null);
    assert.equal(greetingName({ email: '12345@example.com' }), null);
    assert.equal(greetingName({ email: 'a@example.com' }), null);
    assert.equal(greetingName({}), null);
    assert.equal(greetingName(), null);
  });
});

describe('toneForContact', () => {
  test('derives from relationship', () => {
    assert.equal(toneForContact({ relationship: 'family' }), 'warm');
    assert.equal(toneForContact({ relationship: 'friend' }), 'casual');
    assert.equal(toneForContact({ relationship: 'colleague' }), 'friendly');
    assert.equal(toneForContact({ relationship: 'acquaintance' }), 'friendly');
  });

  test('an explicit per-contact tone wins', () => {
    assert.equal(toneForContact({ relationship: 'family', template_tone: 'casual' }), 'casual');
  });

  test('falls back safely on junk', () => {
    assert.equal(toneForContact({ relationship: 'nonsense' }), 'friendly');
    assert.equal(toneForContact({ relationship: 'family', template_tone: 'bogus' }), 'warm');
    assert.equal(toneForContact({}), 'friendly');
  });
});

describe('chooseScenario', () => {
  const base = {
    occasion: null, followUpMatched: false, neverCalled: false,
    daysSinceLastCall: 0, inactivityDays: 14, thresholdDays: 7,
  };

  test('occasion outranks everything', () => {
    assert.equal(chooseScenario({ ...base, occasion: { daysUntil: 0 }, neverCalled: true, daysSinceLastCall: 400 }), 'occasion');
  });

  test('first call outranks the generic nudges', () => {
    assert.equal(chooseScenario({ ...base, neverCalled: true, daysSinceLastCall: Infinity }), 'first_call');
  });

  test('follow-up outranks inactivity but waits a beat', () => {
    assert.equal(chooseScenario({ ...base, followUpMatched: true, daysSinceLastCall: 1 }), null);
    assert.equal(chooseScenario({ ...base, followUpMatched: true, daysSinceLastCall: FOLLOW_UP_MIN_DAYS }), 'follow_up');
    assert.equal(chooseScenario({ ...base, followUpMatched: true, daysSinceLastCall: 40 }), 'follow_up');
  });

  test('returns exactly one scenario when several apply', () => {
    // Regression: the old job emitted planned_call AND inactivity together.
    const s = chooseScenario({ ...base, daysSinceLastCall: 30 });
    assert.equal(typeof s, 'string');
    assert.equal(s, 'inactivity');
  });

  test('nothing when not due', () => {
    assert.equal(chooseScenario({ ...base, daysSinceLastCall: 3 }), null);
  });
});

describe('buildReminder', () => {
  const contact = { id: 'c1', name: 'Mum', relationship: 'family' };
  const ctx = { contact, userName: 'Joy', days: 20, dayKey: '2026-1-1', streak: 0 };

  test('greets the user by name', () => {
    const r = buildReminder('planned_call', { ...ctx, days: 9 });
    assert.match(r.message, /^Hey Joy, /);
  });

  test('drops the greeting cleanly when there is no name', () => {
    const r = buildReminder('planned_call', { ...ctx, userName: null, days: 9 });
    assert.doesNotMatch(r.message, /Hey/);
    assert.doesNotMatch(r.message, /null|undefined/);
    assert.match(r.message, /^[A-Z]/, 'should still start with a capital');
  });

  test('tone changes the wording for the same scenario', () => {
    const warm = buildReminder('inactivity', { ...ctx, tone: 'warm' }).message;
    const casual = buildReminder('inactivity', { ...ctx, tone: 'casual' }).message;
    const friendly = buildReminder('inactivity', { ...ctx, tone: 'friendly' }).message;
    assert.notEqual(warm, casual);
    assert.notEqual(casual, friendly);
  });

  test('variation is stable per day but differs across contacts', () => {
    const a = buildReminder('inactivity', ctx).message;
    const b = buildReminder('inactivity', ctx).message;
    assert.equal(a, b, 're-running the job the same day must not change the copy');

    const other = buildReminder('inactivity', { ...ctx, contact: { ...contact, id: 'c2' } }).message;
    const later = buildReminder('inactivity', { ...ctx, dayKey: '2026-5-9' }).message;
    assert.ok(a !== other || a !== later, 'copy should vary across contacts or days');
  });

  test('every scenario produces a valid, fully-interpolated notification', () => {
    const cases = [
      ['first_call', { ...ctx, days: Infinity }],
      ['planned_call', { ...ctx, days: 9 }],
      ['inactivity', ctx],
      ['follow_up', { ...ctx, days: 5 }],
      ['occasion', { ...ctx, occasionType: 'birthday', label: 'birthday', daysUntil: 0 }],
      ['occasion', { ...ctx, occasionType: 'anniversary', label: 'anniversary', daysUntil: 3 }],
      ['occasion', { ...ctx, occasionType: 'special', label: 'graduation', daysUntil: 3 }],
      ['streak', { ...ctx, contact: undefined, streak: 7 }],
    ];
    for (const [scenario, c] of cases) {
      const r = buildReminder(scenario, c);
      assert.ok(r.title?.length, `empty title for ${scenario}`);
      assert.ok(r.message?.length, `empty message for ${scenario}`);
      assert.ok(SCENARIO_TYPES.includes(r.type), `${r.type} violates the DB CHECK constraint`);
      for (const bad of ['undefined', 'null', 'NaN', 'Infinity', '[object', '{']) {
        assert.ok(!r.message.includes(bad), `"${bad}" leaked into ${scenario}: ${r.message}`);
        assert.ok(!r.title.includes(bad), `"${bad}" leaked into ${scenario} title: ${r.title}`);
      }
    }
  });

  test('a live streak colours other reminders instead of firing separately', () => {
    assert.match(buildReminder('inactivity', { ...ctx, streak: 5 }).message, /5-day run/);
    assert.doesNotMatch(buildReminder('inactivity', { ...ctx, streak: 2 }).message, /run/);
  });

  test('rejects an unknown scenario loudly', () => {
    assert.throws(() => buildReminder('nope', ctx), /Unknown reminder scenario/);
  });
});

describe('reminderSignals', () => {
  test('parseDateOnly does not drift across timezones', () => {
    const d = parseDateOnly('1995-06-15');
    assert.equal(d.getFullYear(), 1995);
    assert.equal(d.getMonth(), 5);
    assert.equal(d.getDate(), 15);
    assert.equal(parseDateOnly(null), null);
    assert.equal(parseDateOnly('garbage'), null);
  });

  test('occasions surface only on the lead days', () => {
    const now = new Date(2026, 0, 10);
    const on = (offset) => {
      const d = new Date(2026, 0, 10 + offset);
      return upcomingOccasionFor({ birthday: `1990-0${d.getMonth() + 1}-${String(d.getDate()).padStart(2, '0')}` }, [], now);
    };
    assert.equal(on(0)?.daysUntil, 0, 'the day itself');
    assert.equal(on(3)?.daysUntil, 3, 'three days out');
    assert.equal(on(1), null, 'no daily countdown');
    assert.equal(on(2), null);
    assert.equal(on(5), null);
  });

  test('the nearest occasion wins', () => {
    const now = new Date(2026, 0, 10);
    const o = upcomingOccasionFor(
      { birthday: '1990-01-13', anniversary: '2010-01-10' }, [], now
    );
    assert.equal(o.occasionType, 'anniversary');
    assert.equal(o.daysUntil, 0);
  });

  test('streaks count back from today or yesterday', () => {
    const now = new Date(2026, 0, 10);
    const day = (n) => new Date(2026, 0, n).toISOString();
    assert.equal(computeCallStreak([day(10), day(9), day(8)], now), 3);
    assert.equal(computeCallStreak([day(9), day(8)], now), 2, 'yesterday is a grace period');
    assert.equal(computeCallStreak([day(8), day(7)], now), 0, 'a two-day gap breaks it');
    assert.equal(computeCallStreak([], now), 0);
  });

  test('milestones are sparse', () => {
    assert.ok(isStreakMilestone(7));
    assert.ok(isStreakMilestone(30));
    assert.ok(!isStreakMilestone(8));
    assert.ok(!isStreakMilestone(2));
  });

  test('follow-up vocabulary needs real history before it says anything', () => {
    assert.equal(matchFollowUpSignal('anything', buildFollowUpVocabulary(new Map())), false);
    const thin = new Map([['c1', [{ date: '2026-01-01', content: 'hospital scan' }]]]);
    assert.equal(matchFollowUpSignal('hospital', buildFollowUpVocabulary(thin)), false);
  });

  test('learns a word that repeatedly precedes a short gap', () => {
    // Long normal gaps, but every note mentioning "hospital" is followed by
    // a much shorter one — that's the signal.
    const notes = [];
    let d = new Date(2026, 0, 1);
    const push = (content, gapDays) => {
      notes.push({ date: new Date(d).toISOString(), content });
      d = new Date(d.getTime() + gapDays * 86_400_000);
    };
    for (let i = 0; i < 4; i++) {
      push('hospital scan results pending', 2);
      push('general catch up nothing pressing', 30);
    }
    push('final', 0);
    const vocab = buildFollowUpVocabulary(new Map([['c1', notes]]));
    assert.ok(vocab.signalWords.has('hospital'), [...vocab.signalWords].join(',') || '(empty)');
    assert.equal(matchFollowUpSignal('hospital again', vocab), true);
    assert.equal(matchFollowUpSignal('totally unrelated words', vocab), false);
  });
});

describe('variantIndex', () => {
  test('is stable and in range', () => {
    assert.equal(variantIndex('abc', 3), variantIndex('abc', 3));
    for (const s of ['a', 'b', 'c1|inactivity|2026-1-1', '']) {
      const i = variantIndex(s, 3);
      assert.ok(i >= 0 && i < 3, `${s} -> ${i}`);
    }
  });

  test('spreads across the available variants', () => {
    const seen = new Set();
    for (let i = 0; i < 60; i++) seen.add(variantIndex(`c${i}|inactivity|2026-1-1`, 3));
    assert.equal(seen.size, 3, 'all three variants should be reachable');
  });
});

// ── One-a-day selection ───────────────────────────────────────────────────

describe('urgencyScore', () => {
  const base = { id: 'c1', name: 'X', relationship: 'acquaintance', call_frequency: 'weekly', priority: 0 };

  test('rises with how overdue the contact is', () => {
    const a = urgencyScore({ contact: base, daysSinceLastCall: 8 }).score;
    const b = urgencyScore({ contact: base, daysSinceLastCall: 40 }).score;
    assert.ok(b > a, `${b} should exceed ${a}`);
  });

  test('overdue weight is halved without enough history', () => {
    const notes = [1, 2, 3].map((d) => ({ date: `2026-01-0${d}`, content: 'x' }));
    const low = urgencyScore({ contact: base, notes: [], daysSinceLastCall: 40 }).score;
    const high = urgencyScore({ contact: base, notes, daysSinceLastCall: 40 }).score;
    assert.ok(high > low, 'a known rhythm should count for more than a guessed one');
  });

  test('favourites, family and priority all lift the score', () => {
    const plain = urgencyScore({ contact: base, daysSinceLastCall: 10 }).score;
    assert.ok(urgencyScore({ contact: { ...base, is_favorite: true }, daysSinceLastCall: 10 }).score > plain);
    assert.ok(urgencyScore({ contact: { ...base, relationship: 'family' }, daysSinceLastCall: 10 }).score > plain);
    assert.ok(urgencyScore({ contact: { ...base, priority: 3 }, daysSinceLastCall: 10 }).score > plain);
  });

  test('never exceeds 100', () => {
    const s = urgencyScore({
      contact: { ...base, relationship: 'family', is_favorite: true, priority: 10 },
      daysSinceLastCall: 9999,
      followUpFlagged: true,
    }).score;
    assert.ok(s <= 100, `${s}`);
  });

  test('averageInterval falls back to the frequency default', () => {
    assert.equal(averageIntervalFor({ call_frequency: 'weekly' }, []), 7);
    assert.equal(averageIntervalFor({ call_frequency: 'monthly' }, []), 30);
  });
});

describe('pickDailyContact', () => {
  const now = new Date(2026, 0, 10);
  const ago = (d) => new Date(2026, 0, 10 - d).toISOString();

  test('picks the most urgent when nobody was nudged recently', () => {
    const pick = pickDailyContact([
      { contact: { id: 'a' }, score: 40, lastNotifiedAt: null },
      { contact: { id: 'b' }, score: 90, lastNotifiedAt: null },
    ], now);
    assert.equal(pick.contact.id, 'b');
  });

  test('rotates away from someone nudged in the last few days', () => {
    const pick = pickDailyContact([
      { contact: { id: 'a' }, score: 90, lastNotifiedAt: ago(1) },
      { contact: { id: 'b' }, score: 40, lastNotifiedAt: null },
    ], now);
    assert.equal(pick.contact.id, 'b', 'the more urgent one was just mentioned');
  });

  test('repeats rather than going silent when everyone is recent', () => {
    // The two-or-three-contact case. Daily is the promise; silence is worse
    // than repetition.
    const pick = pickDailyContact([
      { contact: { id: 'a' }, score: 90, lastNotifiedAt: ago(1) },
      { contact: { id: 'b' }, score: 40, lastNotifiedAt: ago(1) },
    ], now);
    assert.equal(pick.contact.id, 'a');
  });

  test('cycles through everyone before repeating', () => {
    // With several due contacts, the top scorer must not win every time the
    // rotation window lapses — that would surface three people and silently
    // ignore the rest forever.
    const seen = [];
    const pool = ['a', 'b', 'c', 'd', 'e'].map((id, i) => ({
      contact: { id }, score: 90 - i * 10, lastNotifiedAt: null,
    }));
    for (let day = 0; day < 5; day++) {
      const at = new Date(2026, 0, 10 + day);
      const pick = pickDailyContact(pool, at);
      seen.push(pick.contact.id);
      pick.lastNotifiedAt = at.toISOString();
    }
    assert.equal(new Set(seen).size, 5, `only saw ${[...new Set(seen)].join(',')}`);
  });

  test('someone never named outranks someone named at the window edge', () => {
    const pick = pickDailyContact([
      { contact: { id: 'a' }, score: 90, lastNotifiedAt: ago(ROTATION_DAYS) },
      { contact: { id: 'b' }, score: 40, lastNotifiedAt: null },
    ], now);
    assert.equal(pick.contact.id, 'b', 'everyone gets a turn before anyone repeats');
  });

  test('eligibility does return once the window passes', () => {
    // Both already named; the staler one comes back round first.
    const pick = pickDailyContact([
      { contact: { id: 'a' }, score: 40, lastNotifiedAt: ago(ROTATION_DAYS + 2) },
      { contact: { id: 'b' }, score: 90, lastNotifiedAt: ago(ROTATION_DAYS) },
    ], now);
    assert.equal(pick.contact.id, 'a');
  });

  test('urgency breaks ties between equally stale contacts', () => {
    const pick = pickDailyContact([
      { contact: { id: 'a' }, score: 40, lastNotifiedAt: null },
      { contact: { id: 'b' }, score: 90, lastNotifiedAt: null },
    ], now);
    assert.equal(pick.contact.id, 'b');
  });

  test('nothing to pick from', () => {
    assert.equal(pickDailyContact([], now), null);
  });
});

describe('daily copy', () => {
  const contact = { id: 'c1', name: 'Mum', relationship: 'family' };
  const ctx = { contact, userName: 'Joy', days: 20, dayKey: '2026-1-1', streak: 0 };

  test('mentions the others who are due', () => {
    assert.match(buildReminder('inactivity', { ...ctx, alsoDue: 3 }).message, /3 others are due/);
    assert.match(buildReminder('inactivity', { ...ctx, alsoDue: 1 }).message, /One other person/);
    assert.doesNotMatch(buildReminder('inactivity', { ...ctx, alsoDue: 0 }).message, /due too/);
  });

  test('the quiet-day nudge names nobody and invents no urgency', () => {
    const r = buildReminder('nudge', { userName: 'Joy', streak: 0, dayKey: '2026-1-1' });
    assert.ok(SCENARIO_TYPES.includes(r.type));
    assert.ok(r.message.length);
    for (const bad of ['undefined', 'null', 'NaN', 'Infinity']) {
      assert.ok(!r.message.includes(bad), `${bad} leaked: ${r.message}`);
      assert.ok(!r.title.includes(bad));
    }
  });
});

// ── Settings that actually do something ───────────────────────────────────

describe('notification_frequency', () => {
  const now = new Date(2026, 0, 10);
  const ago = (d) => new Date(2026, 0, 10 - d).toISOString();

  test('maps to a period', () => {
    assert.equal(periodDaysFor('daily'), 1);
    assert.equal(periodDaysFor('weekly'), 7);
    assert.equal(periodDaysFor('monthly'), 30);
    assert.equal(periodDaysFor(undefined), 1, 'defaults to daily');
    assert.equal(periodDaysFor('nonsense'), 1);
  });

  test('a first-ever reminder is always due', () => {
    assert.equal(isRoutineDue({ lastRoutineAt: null, notificationFrequency: 'monthly', now }), true);
  });

  test('daily fires every day', () => {
    assert.equal(isRoutineDue({ lastRoutineAt: ago(1), notificationFrequency: 'daily', now }), true);
    assert.equal(isRoutineDue({ lastRoutineAt: ago(0), notificationFrequency: 'daily', now }), false);
  });

  test('weekly holds off for six days', () => {
    for (let d = 0; d < 7; d++) {
      assert.equal(isRoutineDue({ lastRoutineAt: ago(d), notificationFrequency: 'weekly', now }), d >= 7);
    }
    assert.equal(isRoutineDue({ lastRoutineAt: ago(7), notificationFrequency: 'weekly', now }), true);
  });

  test('monthly holds off for a month', () => {
    assert.equal(isRoutineDue({ lastRoutineAt: ago(29), notificationFrequency: 'monthly', now }), false);
    assert.equal(isRoutineDue({ lastRoutineAt: ago(30), notificationFrequency: 'monthly', now }), true);
  });
});
