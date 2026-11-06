import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  pick, str, dateOnly, timestamp, password, normalizeEmail, isValidTimeZone, avatarUrl,
  CONTACT_FIELDS, CONTACT_CREATE_FIELDS, ValidationError,
} from './validate.js';

const rejects = (fn, message) => assert.throws(fn, (e) => e instanceof ValidationError && message.test(e.message));

describe('emails', () => {
  test('normalized: trimmed and lowercased; plus signs and apostrophes kept', () => {
    assert.equal(normalizeEmail('  Alice@Example.COM '), 'alice@example.com');
    assert.equal(normalizeEmail("o'brien+work@x.ie"), "o'brien+work@x.ie");
  });
  test('rejects things that are not addresses', () => {
    for (const bad of ['', 'alice', 'a@b', 'a b@c.com', null, 42, {}]) assert.equal(normalizeEmail(bad), null);
  });
});

describe('passwords', () => {
  test('8 characters to 72 bytes', () => {
    rejects(() => password()('1234567', 'password'), /at least 8/);
    assert.equal(password()('12345678', 'password'), '12345678');
    rejects(() => password()('é'.repeat(37), 'password'), /72 bytes/); // 74 bytes
    rejects(() => password()(12345678, 'password'), /required/);
  });
});

describe('dates', () => {
  test('only real calendar dates', () => {
    assert.equal(dateOnly()('2024-02-29', 'd'), '2024-02-29');
    rejects(() => dateOnly()('2026-02-29', 'd'), /not a real date/);
    rejects(() => dateOnly()('06/01/2026', 'd'), /YYYY-MM-DD/);
    assert.equal(dateOnly()('', 'd'), null);
  });
  test('timestamps normalize to UTC ISO and can refuse the future', () => {
    assert.equal(timestamp()('2026-11-06T09:00:00+01:00', 't'), '2026-11-06T08:00:00.000Z');
    rejects(() => timestamp({ notInFutureBy: 0 })('2999-01-01T00:00:00Z', 't'), /future/);
    rejects(() => timestamp()('yesterday-ish', 't'), /date and time/);
  });
});

describe('contacts', () => {
  test('create requires name, relationship and frequency, and applies defaults', () => {
    const c = pick({ name: '  Mum ', relationship: 'family', call_frequency: 'weekly' }, CONTACT_CREATE_FIELDS);
    assert.deepEqual(c, { name: 'Mum', relationship: 'family', call_frequency: 'weekly', platforms: [], priority: 0, is_favorite: false, avatar: null });
    rejects(() => pick({ relationship: 'family', call_frequency: 'weekly' }, CONTACT_CREATE_FIELDS), /name is required/);
  });
  test('patch checks only what was sent, and ignores unknown keys', () => {
    assert.deepEqual(pick({ is_favorite: true, user_id: 'someone-else' }, CONTACT_FIELDS, { partial: true }), { is_favorite: true });
  });
  test('optional text fields turn blanks into null', () => {
    assert.equal(str({ nullable: true, max: 40 })('   ', 'phone'), null);
  });
  test('avatars must be images', () => {
    assert.equal(avatarUrl()('data:image/png;base64,iVBORw0KGgo=', 'avatar'), 'data:image/png;base64,iVBORw0KGgo=');
    rejects(() => avatarUrl()('javascript:alert(1)', 'avatar'), /image/);
    rejects(() => avatarUrl()('data:text/html;base64,PHNjcmlwdD4=', 'avatar'), /image/);
  });
  test('a body that is not an object is refused', () => {
    rejects(() => pick([], CONTACT_FIELDS), /JSON object/);
    rejects(() => pick(null, CONTACT_FIELDS), /JSON object/);
  });
});

test('timezones', () => {
  assert.equal(isValidTimeZone('Africa/Lagos'), true);
  assert.equal(isValidTimeZone('Mars/Olympus'), false);
  assert.equal(isValidTimeZone(''), false);
});
