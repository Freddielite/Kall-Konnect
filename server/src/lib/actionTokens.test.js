import { test } from 'node:test';
import assert from 'node:assert/strict';
import { issueActionToken, verifyActionToken } from './actionTokens.js';

const ID = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

test('a token works for its own notification and action only', () => {
  const t = issueActionToken(ID, 'snooze');
  assert.equal(verifyActionToken(t, ID, 'snooze'), true);
  assert.equal(verifyActionToken(t, OTHER, 'snooze'), false);
  assert.equal(verifyActionToken(t, ID, 'delete'), false);
});

test('tokens expire after a week', () => {
  const t = issueActionToken(ID, 'snooze', Date.now() - 8 * 24 * 3600_000);
  assert.equal(verifyActionToken(t, ID, 'snooze'), false);
});

test('tampered or junk tokens are refused', () => {
  const t = issueActionToken(ID, 'snooze');
  const [exp, sig] = t.split('.');
  assert.equal(verifyActionToken(`${Number(exp) + 999999}.${sig}`, ID, 'snooze'), false);
  for (const junk of [undefined, '', 'x', 'a.b.c', 42]) assert.equal(verifyActionToken(junk, ID, 'snooze'), false);
});
