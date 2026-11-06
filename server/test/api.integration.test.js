// End-to-end tests against a real server and a real Postgres.
//
//   TEST_DATABASE_URL=postgres://... npm run test:integration
//
// Starts its own server on a spare port (migrations run on boot), so point
// TEST_DATABASE_URL at a throwaway database, never production. Skipped when
// TEST_DATABASE_URL isn't set. CI provides one (.github/workflows/ci.yml).
//
// TRUST_PROXY=1 lets each test use its own X-Forwarded-For address, so the
// per-IP rate limits don't leak between tests or between runs.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import http from 'node:http';

const DB = process.env.TEST_DATABASE_URL;
const serverDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4300 + Math.floor(Math.random() * 500);
const BASE = `http://127.0.0.1:${PORT}`;
const RUN = crypto.randomBytes(4).toString('hex');

// The job tests import server modules directly. Their config is read once,
// on first import, so it's set here before any of them load.
// The same JWT secret for the spawned server and this process, so tokens
// signed here (lock-screen action links) verify there.
const SECRET = crypto.randomBytes(32).toString('hex');
if (DB) {
  process.env.DATABASE_URL = DB;
  process.env.PUBLIC_API_URL = BASE;
  process.env.JWT_SECRET = SECRET;
}

let server;
let db;
// A stand-in for the Slack/Discord webhook: collects what the server posts.
const webhookHits = [];
let webhook;
const WEBHOOK_PORT = PORT + 1000;

const randomIp = () => `10.${crypto.randomInt(255)}.${crypto.randomInt(255)}.${crypto.randomInt(1, 255)}`;

async function api(method, url, { body, token, ip = randomIp(), raw } = {}) {
  const headers = { 'X-Forwarded-For': ip };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(BASE + url, {
    method,
    headers,
    body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  return { status: res.status, body: json, headers: res.headers };
}

let userCount = 0;
async function newUser(prefix = 'user') {
  const email = `${prefix}${++userCount}-${RUN}@example.com`;
  const res = await api('POST', '/auth/register', { body: { email, password: 'correct horse' } });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return { email, ...res.body };
}

async function newContact(token, extra = {}) {
  const res = await api('POST', '/contacts', {
    token, body: { name: 'Mum', relationship: 'family', call_frequency: 'weekly', ...extra },
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.id;
}

async function healthy() {
  const res = await fetch(`${BASE}/health`).catch(() => null);
  return res?.ok === true;
}

describe('API', { skip: !DB && 'TEST_DATABASE_URL not set' }, () => {
  before(async () => {
    webhook = http.createServer((req, res) => {
      let body = '';
      req.on('data', (d) => { body += d; });
      req.on('end', () => { webhookHits.push(JSON.parse(body)); res.end('ok'); });
    }).listen(WEBHOOK_PORT);
    server = spawn(process.execPath, ['src/index.js'], {
      cwd: serverDir,
      env: {
        ...process.env,
        DATABASE_URL: DB,
        PORT: String(PORT),
        TRUST_PROXY: '1',
        JWT_SECRET: SECRET,
        CORS_ORIGIN: 'http://localhost:5173',
        APP_URL: 'http://localhost:5173',
        CRON_CATCH_UP_ON_BOOT: 'false',
        PUBLIC_API_URL: BASE,
        ERROR_WEBHOOK_URL: `http://127.0.0.1:${WEBHOOK_PORT}/hook`,
        NODE_ENV: 'test',
      },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    server.stderr.on('data', (d) => { stderr += d; });
    for (let i = 0; i < 100 && !(await healthy()); i++) await new Promise((r) => setTimeout(r, 100));
    if (!(await healthy())) throw new Error(`server did not start:\n${stderr}`);
    db = new pg.Client({ connectionString: DB });
    await db.connect();
  });

  after(async () => {
    server?.kill();
    webhook?.close();
    await db?.end();
    // The job tests share the server's pool module (imported directly);
    // close it once, here, after every suite that uses it.
    const { pool } = await import('../src/db.js');
    await pool.end();
  });

  describe('hostile requests', () => {
    test('a non-string refresh token is a 401, not a crash', async () => {
      for (const refreshToken of [123, { a: 1 }, ['x'], true]) {
        const res = await api('POST', '/auth/refresh', { body: { refreshToken } });
        assert.equal(res.status, 401);
      }
      assert.ok(await healthy());
    });

    test('malformed ids are a 404, not a crash', async () => {
      const { accessToken } = await newUser();
      for (const [method, url] of [
        ['DELETE', '/contacts/not-a-uuid'],
        ['PATCH', '/contacts/1%27%20OR%201=1'],
        ['POST', '/contacts/xyz/restore'],
      ]) {
        const res = await api(method, url, { token: accessToken, body: {} });
        assert.equal(res.status, 404, `${method} ${url}`);
      }
      const n = await api('POST', '/notifications/xyz/read', { token: accessToken, body: {} });
      assert.equal(n.status, 404);
      assert.ok(await healthy());
    });

    test('malformed JSON is a 400', async () => {
      const res = await fetch(`${BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': randomIp() },
        body: '{"email":',
      });
      assert.equal(res.status, 400);
      assert.ok(await healthy());
    });

    test('security headers are on every response', async () => {
      const res = await api('GET', '/health');
      assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
      assert.equal(res.headers.get('x-frame-options'), 'DENY');
      assert.match(res.headers.get('content-security-policy'), /default-src 'none'/);
      assert.equal(res.headers.get('x-powered-by'), null);
    });
  });

  describe('email addresses', () => {
    test('email is case-insensitive and trimmed', async () => {
      const email = `Mixed.Case+tag-${RUN}@Example.COM`;
      const reg = await api('POST', '/auth/register', { body: { email: `  ${email} `, password: 'correct horse' } });
      assert.equal(reg.status, 200);

      const dup = await api('POST', '/auth/register', { body: { email: email.toLowerCase(), password: 'correct horse' } });
      assert.equal(dup.status, 409);

      const login = await api('POST', '/auth/login', { body: { email: email.toUpperCase(), password: 'correct horse' } });
      assert.equal(login.status, 200);

      const me = await api('GET', '/auth/me', { token: login.body.accessToken });
      assert.equal(me.body.email, email.trim().toLowerCase());
    });

    test("apostrophes and plus signs work", async () => {
      const email = `o'brien+kk-${RUN}@example.com`;
      assert.equal((await api('POST', '/auth/register', { body: { email, password: 'correct horse' } })).status, 200);
      assert.equal((await api('POST', '/auth/login', { body: { email, password: 'correct horse' } })).status, 200);
    });

    test('passwords under 8 characters or over 72 bytes are refused', async () => {
      const short = await api('POST', '/auth/register', { body: { email: `short-${RUN}@example.com`, password: 'abc1234' } });
      assert.equal(short.status, 400);
      assert.match(short.body.error, /at least 8/);
      const long = await api('POST', '/auth/register', { body: { email: `long-${RUN}@example.com`, password: 'é'.repeat(40) } });
      assert.equal(long.status, 400);
    });

    test('forgot-password answers the same for unknown addresses', async () => {
      const { email } = await newUser();
      const known = await api('POST', '/auth/forgot-password', { body: { email } });
      const unknown = await api('POST', '/auth/forgot-password', { body: { email: `nobody-${RUN}@example.com` } });
      assert.equal(known.status, 200);
      assert.deepEqual(known.body, unknown.body);
    });
  });

  describe('data isolation', () => {
    test("user B cannot touch user A's contact", async () => {
      const a = await newUser('a');
      const b = await newUser('b');
      const id = await newContact(a.accessToken);

      assert.equal((await api('PATCH', `/contacts/${id}`, { token: b.accessToken, body: { name: 'pwned' } })).status, 404);
      assert.equal((await api('DELETE', `/contacts/${id}`, { token: b.accessToken })).status, 404);
      assert.equal((await api('POST', `/contacts/${id}/restore`, { token: b.accessToken })).status, 404);
      assert.equal((await api('PUT', `/contacts/${id}/special-dates`, { token: b.accessToken, body: { dates: [] } })).status, 404);
      assert.equal((await api('POST', '/call-notes', { token: b.accessToken, body: { contact_id: id, content: 'x' } })).status, 404);

      const bList = await api('GET', '/contacts', { token: b.accessToken });
      assert.equal(bList.body.items.length, 0);
      const aList = await api('GET', '/contacts', { token: a.accessToken });
      assert.equal(aList.body.items[0].name, 'Mum');
    });
  });

  describe('validation', () => {
    test('bad input is a 400 naming the field, never a database error', async () => {
      const { accessToken: token } = await newUser();
      const cases = [
        [{ relationship: 'friend', call_frequency: 'weekly' }, /name is required/],
        [{ name: 'X', relationship: 'enemy', call_frequency: 'weekly' }, /relationship must be one of/],
        [{ name: 'X', relationship: 'friend', call_frequency: 'weekly', birthday: '2026-02-30' }, /birthday is not a real date/],
        [{ name: 'X', relationship: 'friend', call_frequency: 'weekly', priority: 'high' }, /priority must be a whole number/],
        [{ name: 'X', relationship: 'friend', call_frequency: 'weekly', avatar: 'javascript:alert(1)' }, /avatar must be an image/],
        [{ name: 'x'.repeat(201), relationship: 'friend', call_frequency: 'weekly' }, /at most 200/],
      ];
      for (const [body, message] of cases) {
        const res = await api('POST', '/contacts', { token, body });
        assert.equal(res.status, 400, JSON.stringify(body));
        assert.match(res.body.error, message);
        // Postgres phrasing, e.g. 'violates not-null constraint', 'relation "contacts"'.
        assert.doesNotMatch(res.body.error, /violates|constraint|relation "|column "/);
      }
      const pref = await api('PATCH', '/preferences', { token, body: { reminder_time: '25:00' } });
      assert.equal(pref.status, 400);
      const note = await api('POST', '/call-notes', {
        token, body: { contact_id: await newContact(token), content: 'hi', called_at: '2999-01-01T00:00:00Z' },
      });
      assert.equal(note.status, 400);
      assert.match(note.body.error, /future/);
    });

    test('emoji, accents and right-to-left text round-trip', async () => {
      const { accessToken: token } = await newUser();
      const name = "Ọlá O'Neil 🎉 مرحبا";
      await newContact(token, { name });
      const list = await api('GET', '/contacts', { token });
      assert.equal(list.body.items[0].name, name);
    });
  });

  describe('contacts', () => {
    test('pagination walks every contact exactly once', async () => {
      const { accessToken: token } = await newUser();
      const created = new Set();
      for (let i = 0; i < 7; i++) created.add(await newContact(token, { name: `C${i}` }));

      const seen = [];
      let cursor = null;
      let pages = 0;
      do {
        const res = await api('GET', `/contacts?limit=3${cursor ? `&cursor=${cursor}` : ''}`, { token });
        assert.equal(res.status, 200);
        seen.push(...res.body.items.map((c) => c.id));
        cursor = res.body.nextCursor;
        pages++;
      } while (cursor);
      assert.equal(pages, 3);
      assert.deepEqual(new Set(seen), created);
      assert.equal(seen.length, created.size);

      assert.equal((await api('GET', '/contacts?cursor=garbage', { token })).status, 400);
      assert.equal((await api('GET', '/contacts?limit=100000', { token })).status, 400);
    });

    test('delete is soft and restorable, notes included', async () => {
      const { accessToken: token } = await newUser();
      const id = await newContact(token);
      assert.equal((await api('POST', '/call-notes', { token, body: { contact_id: id, content: 'Talked about her trip' } })).status, 201);

      assert.equal((await api('DELETE', `/contacts/${id}`, { token })).status, 204);
      assert.equal((await api('GET', '/contacts', { token })).body.items.length, 0);
      assert.equal((await api('GET', '/call-notes', { token })).body.items.length, 0);
      const trash = await api('GET', '/contacts/deleted', { token });
      assert.equal(trash.body[0].id, id);
      assert.ok(trash.body[0].purge_after);
      assert.equal((await api('PATCH', `/contacts/${id}`, { token, body: { name: 'x' } })).status, 404);

      assert.equal((await api('POST', `/contacts/${id}/restore`, { token })).status, 200);
      assert.equal((await api('GET', '/contacts', { token })).body.items.length, 1);
      assert.equal((await api('GET', '/call-notes', { token })).body.items[0].content, 'Talked about her trip');
    });

    test('special dates: blank rows are skipped, a bad date changes nothing', async () => {
      const { accessToken: token } = await newUser();
      const id = await newContact(token);
      const ok = await api('PUT', `/contacts/${id}/special-dates`, {
        token, body: { dates: [{ label: 'Graduation', date: '2027-06-01' }, { label: '', date: '' }] },
      });
      assert.equal(ok.status, 200);
      const bad = await api('PUT', `/contacts/${id}/special-dates`, {
        token, body: { dates: [{ label: 'New', date: '2027-01-01' }, { label: 'Bad', date: '2027-13-01' }] },
      });
      assert.equal(bad.status, 400);
      const dates = await api('GET', '/special-dates', { token });
      assert.deepEqual(dates.body.map((d) => d.label), ['Graduation']);
    });
  });

  describe('sessions', () => {
    test('sign out everywhere kills access and refresh tokens at once', async () => {
      const { email } = await newUser();
      const phone = (await api('POST', '/auth/login', { body: { email, password: 'correct horse' } })).body;
      const laptop = (await api('POST', '/auth/login', { body: { email, password: 'correct horse' } })).body;
      assert.equal((await api('GET', '/auth/me', { token: phone.accessToken })).status, 200);

      assert.equal((await api('POST', '/auth/logout-all', { token: laptop.accessToken })).status, 204);

      assert.equal((await api('GET', '/auth/me', { token: phone.accessToken })).status, 401);
      assert.equal((await api('GET', '/auth/me', { token: laptop.accessToken })).status, 401);
      assert.equal((await api('POST', '/auth/refresh', { body: { refreshToken: phone.refreshToken } })).status, 401);

      const again = await api('POST', '/auth/login', { body: { email, password: 'correct horse' } });
      assert.equal((await api('GET', '/auth/me', { token: again.body.accessToken })).status, 200);
    });

    test('two simultaneous refreshes with one token: exactly one wins', async () => {
      const { refreshToken } = await newUser();
      const results = await Promise.all(
        Array.from({ length: 5 }, () => api('POST', '/auth/refresh', { body: { refreshToken } }))
      );
      assert.equal(results.filter((r) => r.status === 200).length, 1);
    });

    test('a refresh token replayed long after rotation signs the user out everywhere', async () => {
      const { refreshToken } = await newUser();
      const rotated = await api('POST', '/auth/refresh', { body: { refreshToken } });
      assert.equal(rotated.status, 200);
      // Pretend the rotation happened two minutes ago (past the race grace).
      await db.query(
        "UPDATE refresh_tokens SET replaced_at = now() - interval '2 minutes' WHERE token_hash = $1",
        [crypto.createHash('sha256').update(refreshToken).digest('hex')]
      );
      assert.equal((await api('POST', '/auth/refresh', { body: { refreshToken } })).status, 401);
      // The legitimate holder of the newer token is signed out too.
      assert.equal((await api('GET', '/auth/me', { token: rotated.body.accessToken })).status, 401);
      assert.equal((await api('POST', '/auth/refresh', { body: { refreshToken: rotated.body.refreshToken } })).status, 401);
    });

    test('a reset link works once, and signs out every session', async () => {
      const user = await newUser();
      const raw = crypto.randomBytes(32).toString('base64url');
      await db.query(
        `INSERT INTO auth_tokens (user_id, token_hash, purpose, expires_at)
         VALUES ($1, $2, 'password_reset', now() + interval '1 hour')`,
        [user.userId, crypto.createHash('sha256').update(raw).digest('hex')]
      );
      const reset = await api('POST', '/auth/reset-password', { body: { token: raw, password: 'new password!' } });
      assert.equal(reset.status, 200);
      assert.equal((await api('POST', '/auth/reset-password', { body: { token: raw, password: 'another one!' } })).status, 400);
      assert.equal((await api('GET', '/auth/me', { token: user.accessToken })).status, 401);
      assert.equal((await api('POST', '/auth/login', { body: { email: user.email, password: 'new password!' } })).status, 200);
    });

    test('an expired reset link is refused', async () => {
      const user = await newUser();
      const raw = crypto.randomBytes(32).toString('base64url');
      await db.query(
        `INSERT INTO auth_tokens (user_id, token_hash, purpose, expires_at)
         VALUES ($1, $2, 'password_reset', now() - interval '1 minute')`,
        [user.userId, crypto.createHash('sha256').update(raw).digest('hex')]
      );
      assert.equal((await api('POST', '/auth/reset-password', { body: { token: raw, password: 'new password!' } })).status, 400);
    });
  });

  describe('rate limits', () => {
    test('failed logins from one IP are limited; successes are not counted', async () => {
      const { email } = await newUser();
      const ip = randomIp();
      for (let i = 0; i < 12; i++) {
        assert.equal((await api('POST', '/auth/login', { ip, body: { email, password: 'correct horse' } })).status, 200);
      }
      const statuses = [];
      for (let i = 0; i < 11; i++) {
        statuses.push((await api('POST', '/auth/login', { ip, body: { email, password: 'wrong' } })).status);
      }
      assert.deepEqual(statuses.slice(0, 10), Array(10).fill(401));
      assert.equal(statuses[10], 429);
      // The real owner on another network is unaffected.
      assert.equal((await api('POST', '/auth/login', { body: { email, password: 'correct horse' } })).status, 200);
    });

    test('guesses spread over many IPs still hit the per-account limit', async () => {
      const { email } = await newUser();
      const statuses = [];
      for (let i = 0; i < 31; i++) {
        statuses.push((await api('POST', '/auth/login', { body: { email, password: `guess${i}` } })).status);
      }
      assert.equal(statuses.filter((s) => s === 401).length, 30);
      assert.equal(statuses[30], 429);
    });
  });

  describe('profile', () => {
    test('timezone is validated and stored', async () => {
      const { accessToken: token } = await newUser();
      assert.equal((await api('PATCH', '/auth/me', { token, body: { timezone: 'Mars/Olympus' } })).status, 400);
      const ok = await api('PATCH', '/auth/me', { token, body: { timezone: 'Africa/Lagos' } });
      assert.equal(ok.status, 200);
      assert.equal(ok.body.timezone, 'Africa/Lagos');
    });

    test('timezone can be sent at registration', async () => {
      const email = `tz-${RUN}@example.com`;
      const reg = await api('POST', '/auth/register', { body: { email, password: 'correct horse', timezone: 'Asia/Kolkata' } });
      const me = await api('GET', '/auth/me', { token: reg.body.accessToken });
      assert.equal(me.body.timezone, 'Asia/Kolkata');
    });
  });

  describe('reminder job', () => {
    let generateNotifications;
    before(async () => {
      ({ generateNotifications } = await import('../src/jobs/generateNotifications.js'));
    });

    const count = async (userId) =>
      (await db.query('SELECT count(*)::int AS n FROM notifications WHERE user_id = $1', [userId])).rows[0].n;

    test("reminds once a day at the user's own local time", async () => {
      const email = `lagos-${RUN}@example.com`;
      const reg = await api('POST', '/auth/register', { body: { email, password: 'correct horse', timezone: 'Africa/Lagos' } });
      const { userId, accessToken: token } = reg.body;
      await api('PATCH', '/preferences', { token, body: { preferred_call_time: 'evening' } });
      await newContact(token);

      // Evening window starts 17:00 in Lagos (UTC+1).
      await generateNotifications({ now: new Date('2030-03-04T15:59:00Z') });
      assert.equal(await count(userId), 0, 'nothing before 17:00 local');

      await generateNotifications({ now: new Date('2030-03-04T16:05:00Z') });
      assert.equal(await count(userId), 1, 'one reminder at 17:05 local');

      await generateNotifications({ now: new Date('2030-03-04T16:20:00Z') });
      await generateNotifications({ now: new Date('2030-03-04T21:50:00Z') });
      assert.equal(await count(userId), 1, 'no repeat the same evening');

      // Next day, seconds earlier than yesterday's run: the old 24-hour
      // arithmetic skipped this one.
      await generateNotifications({ now: new Date('2030-03-05T16:04:59Z') });
      assert.equal(await count(userId), 2, 'one the next evening');
    });

    test('category toggles and the quiet-day switch are respected', async () => {
      const reg = await api('POST', '/auth/register', {
        body: { email: `quiet-${RUN}@example.com`, password: 'correct horse', timezone: 'UTC' },
      });
      const { userId, accessToken: token } = reg.body;
      await api('PATCH', '/preferences', {
        token, body: { preferred_call_time: 'morning', quiet_day_nudges: false, notification_categories: { first_call: false } },
      });
      await newContact(token); // never called: would be a first_call reminder

      await generateNotifications({ now: new Date('2030-03-04T09:00:00Z') });
      assert.equal(await count(userId), 0);
    });

    test('a deleted contact is never the subject of a reminder', async () => {
      const reg = await api('POST', '/auth/register', {
        body: { email: `deleted-${RUN}@example.com`, password: 'correct horse', timezone: 'UTC' },
      });
      const { userId, accessToken: token } = reg.body;
      await api('PATCH', '/preferences', { token, body: { preferred_call_time: 'morning', quiet_day_nudges: false } });
      const id = await newContact(token);
      await api('DELETE', `/contacts/${id}`, { token });

      await generateNotifications({ now: new Date('2030-03-04T09:00:00Z') });
      assert.equal(await count(userId), 0);
    });
  });

  describe('engagement', () => {
    let generateNotifications;
    let generateStreakRiskNudges;
    let pushTargets;
    before(async () => {
      ({ generateNotifications, pushTargets } = await import('../src/jobs/generateNotifications.js'));
      ({ generateStreakRiskNudges } = await import('../src/jobs/streakRisk.js'));
    });

    const reminders = async (userId) =>
      (await db.query('SELECT id, contact_id, type FROM notifications WHERE user_id = $1 ORDER BY created_at', [userId])).rows;

    test('a call can be logged without a note, and updates last called', async () => {
      const { accessToken: token } = await newUser();
      const id = await newContact(token);
      const res = await api('POST', '/call-notes', { token, body: { contact_id: id } });
      assert.equal(res.status, 201);
      assert.equal(res.body.content, '');
      const [c] = (await api('GET', '/contacts', { token })).body.items;
      assert.ok(c.last_called, 'last_called set by the server');
    });

    test('a backdated call never moves last called backwards', async () => {
      const { accessToken: token } = await newUser();
      const id = await newContact(token);
      await api('POST', '/call-notes', { token, body: { contact_id: id, content: 'today' } });
      const before = (await api('GET', '/contacts', { token })).body.items[0].last_called;
      await api('POST', '/call-notes', { token, body: { contact_id: id, content: 'old', called_at: '2020-01-01T10:00:00Z' } });
      const after = (await api('GET', '/contacts', { token })).body.items[0].last_called;
      assert.equal(after, before);
    });

    test('reminder opened, then a call logged: both recorded', async () => {
      const reg = await api('POST', '/auth/register', { body: { email: `measure-${RUN}@example.com`, password: 'correct horse', timezone: 'UTC' } });
      const { userId, accessToken: token } = reg.body;
      await api('PATCH', '/preferences', { token, body: { preferred_call_time: 'morning' } });
      const contactId = await newContact(token);
      await generateNotifications({ now: new Date('2030-05-01T09:00:00Z') });
      const [n] = await reminders(userId);
      assert.equal(n.contact_id, contactId);

      assert.equal((await api('POST', `/notifications/${n.id}/opened`, { token })).status, 200);
      await api('POST', '/call-notes', { token, body: { contact_id: contactId } });
      const { rows: [row] } = await db.query('SELECT opened_at, acted_at, read_at FROM notifications WHERE id = $1', [n.id]);
      assert.ok(row.opened_at && row.acted_at && row.read_at);
    });

    test('pushes link to the person, with Call and Remind-tomorrow buttons', () => {
      const id = '11111111-1111-4111-8111-111111111111';
      const contact = '22222222-2222-4222-8222-222222222222';
      const t = pushTargets(id, contact);
      assert.equal(t.url, `/contacts/${contact}?kkn=${id}`);
      assert.deepEqual(t.actions.map((a) => a.action), ['call', 'snooze']);
      assert.match(t.data.snoozeUrl, new RegExp(`^${BASE}/notifications/${id}/snooze\\?t=`));
      assert.equal(pushTargets(id, null).actions, undefined);
    });

    test('"Remind me tomorrow" from the lock screen beats the rotation', async () => {
      const reg = await api('POST', '/auth/register', { body: { email: `snooze-${RUN}@example.com`, password: 'correct horse', timezone: 'UTC' } });
      const { userId, accessToken: token } = reg.body;
      await api('PATCH', '/preferences', { token, body: { preferred_call_time: 'morning', quiet_day_nudges: false } });
      await newContact(token, { name: 'Ada' });
      await newContact(token, { name: 'Bayo' });

      await generateNotifications({ now: new Date('2030-06-01T09:00:00Z') });
      const [first] = await reminders(userId);

      // Bad and forged tokens are refused.
      assert.equal((await api('POST', `/notifications/${first.id}/snooze?t=junk`)).status, 403);
      const forged = pushTargets('33333333-3333-4333-8333-333333333333', first.contact_id).data.snoozeUrl.split('?t=')[1];
      assert.equal((await api('POST', `/notifications/${first.id}/snooze?t=${forged}`)).status, 403);

      // The real one, as the service worker would call it: no session.
      const token2 = pushTargets(first.id, first.contact_id).data.snoozeUrl.split('?t=')[1];
      const snooze = await api('POST', `/notifications/${first.id}/snooze?t=${token2}`);
      assert.equal(snooze.status, 200);
      assert.match(snooze.body.remindOn, /^\d{4}-\d{2}-\d{2}$/);

      // Next day the rotation would move on to the other person; the
      // explicit request wins, and is used up.
      await generateNotifications({ now: new Date('2030-06-02T09:00:00Z') });
      const second = (await reminders(userId))[1];
      assert.equal(second.contact_id, first.contact_id);
      const { rows: [c] } = await db.query('SELECT remind_next_on FROM contacts WHERE id = $1', [first.contact_id]);
      assert.equal(c.remind_next_on, null);
    });

    test('the in-app fallback works too, and only for your own reminders', async () => {
      const reg = await api('POST', '/auth/register', { body: { email: `snooze-app-${RUN}@example.com`, password: 'correct horse', timezone: 'Africa/Lagos' } });
      const { userId, accessToken: token } = reg.body;
      await api('PATCH', '/preferences', { token, body: { preferred_call_time: 'morning' } });
      await newContact(token);
      await generateNotifications({ now: new Date('2030-07-01T09:00:00Z') });
      const [n] = await reminders(userId);
      const other = await newUser();
      assert.equal((await api('POST', `/notifications/${n.id}/remind-tomorrow`, { token: other.accessToken })).status, 404);
      assert.equal((await api('POST', `/notifications/${n.id}/remind-tomorrow`, { token })).status, 200);
    });

    test('evening streak nudge: once, after 7pm, only when the streak is at risk', async () => {
      const reg = await api('POST', '/auth/register', { body: { email: `streak-${RUN}@example.com`, password: 'correct horse', timezone: 'UTC' } });
      const { userId, accessToken: token } = reg.body;
      const contactId = await newContact(token);
      // Called on each of the two days before 2030-08-10, not on the day.
      for (const day of ['2030-08-08', '2030-08-09']) {
        await db.query(
          "INSERT INTO call_notes (contact_id, user_id, content, called_at) VALUES ($1, $2, '', $3)",
          [contactId, userId, `${day}T12:00:00Z`]
        );
      }
      const count = async () => (await reminders(userId)).filter((r) => r.type === 'streak_risk').length;

      await generateStreakRiskNudges({ now: new Date('2030-08-10T18:59:00Z') });
      assert.equal(await count(), 0, 'not before 7pm');
      await generateStreakRiskNudges({ now: new Date('2030-08-10T19:05:00Z') });
      assert.equal(await count(), 1);
      await generateStreakRiskNudges({ now: new Date('2030-08-10T21:00:00Z') });
      assert.equal(await count(), 1, 'once an evening');

      // Next evening, having called that day: streak safe, no nudge.
      await db.query(
        "INSERT INTO call_notes (contact_id, user_id, content, called_at) VALUES ($1, $2, '', '2030-08-11T10:00:00Z')",
        [contactId, userId]
      );
      await generateStreakRiskNudges({ now: new Date('2030-08-11T19:30:00Z') });
      assert.equal(await count(), 1);
    });

    test('the streak nudge respects its Settings switch', async () => {
      const reg = await api('POST', '/auth/register', { body: { email: `streak-off-${RUN}@example.com`, password: 'correct horse', timezone: 'UTC' } });
      const { userId, accessToken: token } = reg.body;
      await api('PATCH', '/preferences', { token, body: { notification_categories: { streak_risk: false } } });
      const contactId = await newContact(token);
      for (const day of ['2030-09-08', '2030-09-09']) {
        await db.query("INSERT INTO call_notes (contact_id, user_id, content, called_at) VALUES ($1, $2, '', $3)", [contactId, userId, `${day}T12:00:00Z`]);
      }
      await generateStreakRiskNudges({ now: new Date('2030-09-10T19:30:00Z') });
      assert.equal((await reminders(userId)).length, 0);
    });
  });

  describe('your data', () => {
    test('export has everything, and no secrets', async () => {
      const user = await newUser();
      const id = await newContact(user.accessToken, { name: 'Mum' });
      await api('POST', '/call-notes', { token: user.accessToken, body: { contact_id: id, content: 'Her garden' } });
      const res = await api('GET', '/account/export', { token: user.accessToken });
      assert.equal(res.status, 200);
      assert.match(res.headers.get('content-disposition'), /attachment; filename="kall-konnect-export-/);
      assert.equal(res.body.profile.email, user.email);
      assert.equal(res.body.contacts[0].name, 'Mum');
      assert.equal(res.body.callNotes[0].content, 'Her garden');
      const text = JSON.stringify(res.body);
      for (const secret of ['password_hash', 'token_hash', 'refresh_token', 'p256dh', user.userId === undefined ? '' : 'user_id']) {
        if (secret) assert.ok(!text.includes(secret), `export contains ${secret}`);
      }
    });

    test('deleting an account needs the password, then removes everything', async () => {
      const user = await newUser();
      const id = await newContact(user.accessToken);
      await api('POST', '/call-notes', { token: user.accessToken, body: { contact_id: id, content: 'x' } });

      assert.equal((await api('DELETE', '/account', { token: user.accessToken, body: { password: 'wrong' } })).status, 403);
      assert.equal((await api('DELETE', '/account', { token: user.accessToken, body: { password: 'correct horse' } })).status, 204);

      assert.equal((await api('GET', '/auth/me', { token: user.accessToken })).status, 401);
      assert.equal((await api('POST', '/auth/login', { body: { email: user.email, password: 'correct horse' } })).status, 401);
      for (const table of ['contacts', 'call_notes', 'user_preferences', 'refresh_tokens']) {
        const { rows: [r] } = await db.query(`SELECT count(*)::int AS n FROM ${table} WHERE user_id = $1`, [user.userId]);
        assert.equal(r.n, 0, `${table} not emptied`);
      }
    });

    test('a Google-only account confirms deletion by typing its email', async () => {
      const user = await newUser();
      await db.query('UPDATE users SET password_hash = NULL WHERE id = $1', [user.userId]);
      const me = await api('GET', '/auth/me', { token: user.accessToken });
      assert.equal(me.body.hasPassword, false);
      assert.equal((await api('DELETE', '/account', { token: user.accessToken, body: { email: 'someone@else.com' } })).status, 403);
      assert.equal((await api('DELETE', '/account', { token: user.accessToken, body: { email: user.email.toUpperCase() } })).status, 204);
    });
  });

  describe('monitoring', () => {
    test('/health/reminders is red until reminders have run, then green', async () => {
      await db.query("DELETE FROM job_heartbeats WHERE name = 'reminders'");
      assert.equal((await api('GET', '/health/reminders')).status, 503);
      await db.query("INSERT INTO job_heartbeats (name, last_success_at) VALUES ('reminders', now() - interval '3 hours')");
      assert.equal((await api('GET', '/health/reminders')).status, 503, 'stale counts as down');
      await db.query("UPDATE job_heartbeats SET last_success_at = now() WHERE name = 'reminders'");
      const ok = await api('GET', '/health/reminders');
      assert.equal(ok.status, 200);
      assert.equal(ok.body.ok, true);
    });

    test('browser errors reach the webhook, once', async () => {
      webhookHits.length = 0;
      const body = { message: `TypeError: boom ${RUN}`, path: '/contacts' };
      assert.equal((await api('POST', '/client-errors', { body })).status, 204);
      assert.equal((await api('POST', '/client-errors', { body })).status, 204);
      await new Promise((r) => setTimeout(r, 300));
      const hits = webhookHits.filter((h) => h.text.includes(`boom ${RUN}`));
      assert.equal(hits.length, 1, 'throttled to one alert');
      assert.equal(hits[0].content, hits[0].text, 'Slack and Discord fields both set');
    });
  });

  describe('onboarding', () => {
    test('new accounts start un-onboarded; finishing records it', async () => {
      const { accessToken: token } = await newUser();
      assert.equal((await api('GET', '/preferences', { token })).body.onboarded_at, null);
      assert.equal((await api('POST', '/preferences/onboarded', { token })).status, 200);
      assert.ok((await api('GET', '/preferences', { token })).body.onboarded_at);
    });
  });
});
