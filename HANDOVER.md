# HANDOVER

Living session log for kall-konnect-mvp. Newest entries on top.

---

## NEXT UP — notifications

Consolidated from the 2026-09-02 (a)-(f) entries below, so the open items
aren't scattered across six changelogs. Ordered by what's actually blocking
what. Nothing here is started.

### 0. Deploy checklist (not code — but none of the work below reaches a user until this is done)

- `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` on Render (`npx web-push
  generate-vapid-keys`). Without them push is silently skipped and only the
  in-app bell works. **Regenerating later invalidates every row in
  `push_subscriptions`** — users would each have to re-toggle notifications.
- `VAPID_SUBJECT` must be a real `mailto:` or `https:` URL. The
  `.env.example` default (`mailto:admin@example.com`) is a placeholder, and a
  bare email with no `mailto:` scheme is rejected outright by web-push.
- `CRON_TIMEZONE=Africa/Lagos`. Render runs UTC, so without it reminders go
  out at 07:00 WAT rather than 06:00.
- `npm run migrate` — 005 through 010 are all unapplied on a live database.
  **005 contains a destructive DELETE** (older unread duplicates); read it
  first, and drop that block if the history matters.
- Anyone who tried enabling notifications before the VAPID keys existed has
  no subscription row — `enablePushNotifications()` bailed early. They must
  toggle it off and on again. `npm run notifications-doctor` distinguishes
  "keys missing" from "keys fine, zero subscriptions".
- Free-tier instance-hours: keeping one service awake 24/7 consumes most of
  the monthly allowance. A second free service would exhaust it and suspend
  things mid-month, which looks like the app dying for no reason. Verify
  current limits on Render's pricing page.

### 1. Timezone column — blocks three separate things

`users` and `user_preferences` have no timezone. Capture it at signup from
`Intl.DateTimeFormat().resolvedOptions().timeZone`, then switch the cron to
run hourly and select users whose local hour matches their `reminder_time`.

This is the single highest-value item because it unblocks:

- **`preferred_call_time` is currently a lying control.**
  morning/afternoon/evening/anytime sits in Settings and is read by no code
  at all. Either wire it or pull it from the UI — leaving it is the exact
  problem the (d) entry was about.
- **`reminder_time` is unused** for the same reason.
- **Streak-at-risk reminders.** Can't exist on a 06:00 job: at 6am nobody has
  had a chance to call anyone, so "your streak is about to break" would fire
  every single morning. Needs an evening run in the user's own timezone.
  Milestones-only is the current stopgap (`isStreakMilestone`).

`CRON_TIMEZONE` (f) is a global setting for everyone, not a substitute.

### 2. `/contacts/:id` route

Push payloads now carry `url`, and `sw.js` navigates on click — but there's
no per-contact route, so every reminder lands on the Dashboard. A reminder
about Mum should open Mum. Small change in `App.tsx` + `Contacts.tsx`; then
set `url: /contacts/${n.contactId}` in `generateNotifications.js`.

### 3. Push action buttons

`actions: [{ action: 'call' }, { action: 'snooze' }]` in the payload plus
handling in `sw.js`'s `notificationclick`. Lets someone act from the lock
screen without opening the app, which is most of the value of push for this
particular app. Depends on 2 for the "call" target.

### 4. Marking read in-app should clear the OS notification

Reading a reminder in the bell leaves it sitting in the Android shade. Needs
a `registration.getNotifications({ tag })` sweep in `sw.js`, triggered from
the client on `markAsRead` / `markAllAsRead`.

### 5. `reminder_tone` is a dead column

`friendly|professional|casual` in `user_preferences`, read by nothing, and
superseded by the per-contact tone in (b). Never surfaced in the UI so it
isn't lying to users — but it should be dropped or reconciled rather than
left as a decoy for the next person reading the schema.

### 6. Tuning that needs real usage data, not more thinking

- `ROTATION_DAYS = 3` (reminderSignals.js) — how long before the same person
  can be named again. Picked by judgement, never validated.
- The quiet-day nudge (on by default) — genuinely unclear whether users find
  it supportive or annoying. `quiet_day_nudges` lets them switch it off;
  watch how many do.
- `OCCASION_LEAD_DAYS = [3, 0]` — two touches per birthday. Might want 7 for
  people who need to plan.

### 7. Keep the external trigger even though the pinger works

`POST /jobs/generate-notifications` + `.github/workflows/daily-reminders.yml`
are currently belt-and-braces, since the 5-minute pinger keeps node-cron
alive. Worth keeping: the pinger and the reminders share a single point of
failure that fails *silently* — nothing logs an error when a job simply
doesn't run. The job is idempotent for the day, so both firing can't
double-send (verified in (f)).

### Unrelated, but noticed and left alone

`npx tsc --noEmit` reports two pre-existing errors, in
`src/components/ImportContactsDialog.tsx` (type predicate vs optional
`phone`) and `src/components/ui/button.tsx` (framer-motion `onDrag`
conflict). Both are present in the original upload and untouched by any
notification work.

---

## 2026-09-02 (g) — Purged the leftover "999 days" rows

Reported still visible in the bell after (e). Not a regression — no code path
can produce that string any more (verified: the only remaining `999`s in the
tree are numeric inputs to `urgencyScore`, never rendered, and there's a test
asserting the copy never contains it in any tone or variant). These were rows
already written to the database, which the bell keeps showing because it
reads the last 20 notifications regardless of age.

**Why 005 missed them.** Its cleanup de-duplicates per
`(user_id, contact_id, type)` and keeps the newest of each group. The old job
emitted a `planned_call` AND an `inactivity` for the same contact, so each was
the sole survivor of its own group and both stayed — precisely the two rows in
the report.

Migration `010_purge_999_notifications.sql` deletes them. Scope is narrow on
purpose: it matches the message text AND requires `contacts.last_called IS
NULL`, which is what proves the row is the bug rather than a genuine ~2.7-year
gap. A second statement covers orphaned rows whose contact was deleted
(`contact_id` SET NULL). Verified against a table of representative rows: the
four bug rows go, including an already-read one; a real 999-day gap on a
contact that *has* been called survives, as do the new corrected copy and
unrelated notifications.

Nothing is lost — those contacts are still never-called, so the next job run
regenerates a correct first_call reminder for them.

`notifications-doctor` now counts remaining `%999 days%` rows and names 010 as
the fix, and its migration check covers 005-010 rather than stopping at 007.

**Worth internalising:** a copy fix only changes what gets written *next*.
Anything already in `notifications` keeps rendering until it's cleaned up or
ages past the bell's LIMIT 20. Same applies to any future copy change.

---

## 2026-09-02 (f) — Keep-alive setup: idempotency, timezone, missed runs

Backend is kept awake by an external pinger, so `node-cron` does fire and the
Render-sleep problem in (e) doesn't apply here. Three consequences.

**1. Double-send bug, found by testing two triggers on one morning.** With
both node-cron and an external trigger — or just a redeploy — the job ran
twice and sent twice. Cause: occasions skip the routine pick by design, but
`type = 'occasion'` wasn't in the routine-recency gate, so the second run saw
the routine slot as unused and fired a second push five minutes after the
first. 'occasion' is now in that list: an occasion firing means the user has
already been notified today. Verified — runs at 06:00 / 06:05 / 06:05:30 /
14:22 now produce exactly one notification.

This makes the job safe to run from any number of triggers, which is the
point: keep-alive plus node-cron, external cron, manual curl, and a redeploy
can all coexist without the user noticing.

**2. `CRON_TIMEZONE`.** Server time is UTC on Render, so `0 6 * * *` reached a
Nigerian user at 07:00 WAT. `CRON_TIMEZONE=Africa/Lagos` makes it 06:00 local
without touching the expression. `CRON_SCHEDULE` is configurable too.
Verified node-cron accepts both the `{ timezone }` option and `undefined`.
Still one global time for everyone — per-user `reminder_time` needs the
timezone column.

**3. Catch-up on boot** (`CRON_CATCH_UP_ON_BOOT`, default on). Once the
instance is kept awake, the main residual risk is a restart or redeploy
straddling the scheduled minute: node-cron has no concept of a missed run, so
that day gets nothing. The job now re-runs ~10s after startup. Safe precisely
because of (1) — if today's reminder already went out it does nothing.

The `POST /jobs/generate-notifications` endpoint and GitHub Actions workflow
from (e) stay. They're now belt-and-braces rather than load-bearing, and
worth keeping: a pinger is a silent single point of failure, and if it stops,
notifications stop with nothing logging an error anywhere.

Tests 59, replay 14/14.

---

## 2026-09-02 (e) — Push actually reaching people; 999-day fix; category switches

Prompted by a screenshot of the live app showing two notifications for the
same contact, both reading "It's been 999 days since your last call with
Freddie Ose". Both were already fixed in (a)/(b) but not deployed.

**1. The daily job never runs on Render's free tier — the real reason push
looks broken.** `node-cron` schedules in-process; free instances spin down
after ~15 min idle, so at 06:00 there is nothing running. No job, no
notifications, no pushes, and nothing logs an error because nothing ran.

New `POST /jobs/generate-notifications`, authenticated with a `CRON_SECRET`
shared secret (machine caller, no cookies). 503 when the secret isn't
configured so a misconfigured deploy is distinguishable from a wrong secret.
`.github/workflows/daily-reminders.yml` calls it daily with a 180s curl
timeout — a sleeping instance needs 30-60s to wake before the job starts.
`workflow_dispatch` included for manual runs. The server warns at startup if
NODE_ENV=production and CRON_SECRET is unset. DEPLOYING.md §1b covers it.

**2. "999 days" replaced with days since the contact was added.** `last_called`
is null for a never-called contact and was being coerced to 999. (b) had
dropped the number entirely; counting from `contacts.created_at` is better —
"you added them 11 days ago". `addedLabel()` handles today/yesterday/N days
and degrades to "a while back" rather than leaking NaN when created_at is
missing.

**3. Six per-category switches** (migration 009, `notification_categories`
JSONB). Routine check-ins, long silences, birthdays, unfinished
conversations, new contacts, streak milestones. JSONB rather than six columns
so a seventh category doesn't need another migration. **A missing key means
enabled** — rows written before 009 must not silently go quiet.

**4. The push payload was nearly useless.** title+body only: no icon (Android
fell back to a generic bell), no tag (a week away meant seven separate
notifications to swipe), and no url, so sw.js's click handler just focused
whatever tab it found. Now sends `icon`/`badge` (icon-192, not the 16px
favicon), a per-contact `tag` so repeat reminders collapse, and `url`. sw.js
navigates on click rather than only focusing. Taps land on the Dashboard —
there is no `/contacts/:id` route to deep-link to, which is worth adding.

Frontend typechecks clean; the two pre-existing errors in
`ImportContactsDialog.tsx` and `ui/button.tsx` were confirmed present in the
original upload and are untouched.

Tests 56, replay 14/14. Both counts include the regression that started this:
"never renders 999, in any tone or variant".

**Still open.** `preferred_call_time` and `reminder_time` remain unwired —
both need the timezone column. Streak-at-risk needs an evening run. A
`/contacts/:id` route would make push taps land on the right person.

---

## 2026-09-02 (d) — Made the Settings switches real

Two controls on the Settings screen were persisted, rendered, and read by
nothing. Shipping (c)'s quiet-day nudge with no control at all would have
made three.

**`notification_frequency` now works.** daily / weekly / monthly gates the
routine "here's who to call" reminder via `isRoutineDue()`. It has been in
the schema and on the Settings screen since the Supabase days and the job
always ran daily regardless of what the user picked. Occasions and streak
milestones deliberately ignore it — they're events, not a cadence, and a
birthday shouldn't wait for your weekly slot. Verified: weekly gives 3
notifications over 21 days, monthly gives 2 over 60.

**`quiet_day_nudges` added** (migration 008, defaults true to match (c)'s
behaviour) with a switch in Settings, disabled while notifications are off.
Verified: false gives 0 notifications on days nobody is due.

Also corrected two pieces of helper text that described behaviour that never
existed: "How often to check for planned calls and inactive contacts" (it
doesn't check, it sends), and "Alert when you haven't called a contact in
this many days" (inactivity_days doesn't trigger a separate alert, it
changes how the reminder is worded).

**`preferred_call_time` is still a lie.** morning/afternoon/evening/anytime
is on the Settings screen and read by nothing. It can't be honoured until
the job is timezone-aware — the same blocker as `reminder_time`. Either wire
both together or pull the control until then; leaving it is the thing this
entry is about.

`reminder_tone` is dead too, but only as a column — it was never surfaced in
the UI, so it isn't lying to anyone. Notification voice comes from the
contact's tone as of (b).

Tests at 50. Behaviour verified end-to-end at 11/11 in the stubbed-DB replay.

---

## 2026-09-02 (c) — One reminder per day, naming one person

Corrects a wrong call in (a). The cooldown added there was per-contact and
was applied to *delivery*, so a user with eight overdue contacts got a burst
of pushes one morning and silence for the next six days. The app exists so
people don't forget to call — the cadence to the USER has to be daily. What
must not be daily is nudging about the same PERSON.

**Now: exactly one routine notification per user per day.** It names one
contact, chosen by `pickDailyContact()`. Measured over 10 days with 8
overdue contacts: 80 pushes before, 10 after — and one every day rather than
eight on Monday and none until Friday.

**Ranking reuses the Dashboard's urgency score.** `useCallAnalytics.ts`
already scored contacts on days overdue, follow-up signal, favourite,
relationship and priority, and the Dashboard shows the top 7 by it. The job
had invented its own separate idea of who was due, so the push and the
screen the user opened could disagree about who mattered. `urgencyScore()`
in `reminderSignals.js` is a numerically identical port — change one, change
both.

**Rotation is least-recently-named first, urgency as tiebreaker.** The first
attempt filtered by staleness then picked purely on score, which looped over
the top three contacts and never mentioned the other five. Ordering by
staleness surfaces all eight over eight days. A contact named within
ROTATION_DAYS (3) is held back entirely; if every candidate is that recent —
the normal case at two or three contacts — it falls back to urgency and
repeats a name, because silence is worse than repetition here.

**Quiet days still send something** (`nudge` type, migration 007, no contact
attached): short encouragement, no manufactured urgency. A daily habit with
holes in it isn't a habit. If this grates, it's one `if` block in
generateNotifications.js.

**Occasions are exempt from the cap**, since two people can share a birthday
and missing one because the day was "used up" would be the worst failure
this job has. A day with an occasion skips the routine pick, so in practice
the count is still 1 almost every day.

**Verified** by replaying against a stubbed DB: one per day with no gaps and
no bursts over 14 days; all 8 due contacts named within 8 days; a contact
called today is never nudged about (6 quiet-day nudges instead); a
2-contact user alternates; a snoozed contact is never named, and a user
whose only contact is snoozed goes fully silent. Unit tests are at 45, still
no DB, .env or `npm install` required.

**Still open.** `ROTATION_DAYS` and the quiet-day nudge are both guesses that
want real usage data. The streak-at-risk case still can't work until the job
is timezone-aware and can run in the evening.

---

## 2026-09-02 (b) — Dynamic, scenario-aware reminder copy

Reminders now greet the user by name and change wording by *why* they're
firing and *who* they're about. New pure modules `reminderCopy.js` and
`reminderSignals.js` alongside `reminderRules.js`; migration
`006_notification_scenarios.sql`.

**Six scenarios, one per contact per run**, chosen by specificity rather
than urgency in `chooseScenario()`:

  occasion > first_call > follow_up > inactivity > planned_call

plus `streak`, which is user-level and can't be decided in the contact loop.
A birthday outranks "you're overdue" because it's time-critical and
unrepeatable; a follow-up outranks a generic nudge because it names an
actual reason to call. `notifications.type` carries the scenario, so the
CHECK constraint had to widen from two values to six — mirrored in
`SCENARIO_TYPES` (reminderCopy.js) and the icon map in
`NotificationsBell.tsx`. Change all three together.

**Tone comes from the contact, not a global setting.** There were two
overlapping tone vocabularies: `user_preferences.reminder_tone`
(`friendly|professional|casual`, read by nothing) and the frontend's
`TemplateTone` (`warm|casual|friendly`, per-contact, derived from
relationship, and actually *learned* from user picks by `toneLearning.ts`).
Notification copy uses the latter, so a nudge about your mother doesn't read
like a nudge about a colleague. `reminder_tone` is still unused — it should
probably be removed or reconciled rather than left as a setting that lies.

**Greeting.** `users.display_name` is nullable and never required at signup
(Google supplies one, email signup doesn't), so `greetingName()` falls back
to the email local part — "joy.okafor@x.com" -> "Joy". It returns null for
junk (`info@`, `noreply@`, numeric, single letters) and the greeting is
dropped entirely in that case, with the sentence re-capitalised. That
re-capitalisation was a real bug the tests caught: every phrasing is written
to follow "Hey Joy, ", so without it the copy opened lowercase.

**Variation** is deterministic — seeded on `contact|scenario|dayKey`, so
re-running the job on the same day produces identical copy (no churn if the
doctor is run twice), but different contacts and different days get
different phrasings out of three per scenario/tone.

**Occasions bypass the cooldown**, since a birthday can't be rescheduled.
They have a narrower guard instead: `OCCASION_LEAD_DAYS` is `[3, 0]`, so two
touches per occasion, not a daily countdown.

**Streaks: milestones only.** A "your streak is at risk" nudge cannot work
on a 06:00 job — at 6am nobody has had a chance to call anyone yet, so it
would fire every single morning. Milestones (3/7/14/30/50/100/200/365) get
their own notification; a live streak of 3+ otherwise just appends a line to
whatever else fired. This wants revisiting once the job is timezone-aware
and can run in the evening.

`streaks.ts`, `noteSignals.ts` and `occasions.ts` were client-side only, so
`reminderSignals.js` ports them behaviourally unchanged — the Dashboard and
the notification you receive must not disagree about the same contact. Note
`parseDateOnly`: db.js parses DATE columns as raw strings, and
`new Date("1995-06-15")` reads as UTC midnight and can land a day early.

**Tests: 30, still no DB, .env or `npm install` required** — the new modules
are import-free for exactly this reason. Coverage includes every scenario
producing fully-interpolated copy (asserting no `undefined`/`NaN`/`Infinity`
leaks), tone actually changing wording, variation being stable per day,
occasions firing only on lead days, and the follow-up vocabulary staying
silent until there's real history. `npm run notifications-doctor` now prints
the generated message under each contact.

---

## 2026-09-02 — Notification correctness pass

Four bugs in the reminder pipeline, all in `jobs/generateNotifications.js`
except where noted. New migration `005_notification_dedupe.sql`.

**1. Push arrived 24h before the in-app notification existed.** The job set
`scheduled_for = now()+1day` but called `sendPushToUser` immediately, while
`GET /notifications` filters `scheduled_for <= now()`. So the phone push
landed at 06:00 and tapping it opened an empty bell; the reminder surfaced
the *next* morning. `scheduled_for` is now `now()`. This removed the need
for a separate due-dispatch pass, so `cron.js` is unchanged.

**2. A duplicate per contact per day, forever.** The dedupe guard was
`sent_at IS NULL AND scheduled_for >= now()`, but nothing in the codebase
ever wrote `sent_at`, and `scheduled_for` was always exactly one day out —
so by the next daily run the guard row had already fallen out of its own
window. Whether it blocked at all came down to a millisecond comparison.
The bell's `LIMIT 20` then filled with twenty copies of one person.

Replaced with a cooldown on the most recent `created_at` per contact, set
to that contact's own call frequency: a weekly contact surfaces at most
weekly, a monthly one at most monthly. Half-frequency was tried first and
still produced 8 nudges in 30 days — better than 30, still nagging.

Separately, the existence check ran *once* before both the `planned_call`
and `inactivity` branches, so a contact past both thresholds got two
near-identical rows and two pushes the same morning. Since the default
`inactivity_days` (14) equals biweekly's threshold, that was most contacts.
`chooseReminder()` now returns at most one; inactivity wins when both apply,
as it's the stronger signal.

**3. `snoozed_until` was ignored here.** Already respected by the Dashboard
and by `mcpTools.js`, but not by the job — so snoozing via
`RescheduleDialog` silenced a contact in the UI while the daily push kept
arriving. Now filtered in SQL.

**4. The notifications WebSocket event was never sent.** `useNotifications`
has always listened for `{ type: 'notifications' }`, but the only
`broadcastToUser` calls were in `routes/contacts.js`. The bell never
live-updated; it refreshed on remount. The job now broadcasts once per user
when it creates anything, and `routes/notifications.js` broadcasts on
read/read-all so the unread badge syncs across devices.

Also: `sendPushToUser` returns `{ delivered, failed }` so `sent_at` reflects
what actually happened rather than being assumed. A contact with
`last_called = null` was generating "It's been 999 days since your last call
with Mum" — the never-called case now has its own copy. And the `.ics` /
Google Calendar block moved from `planned_call`-only to both types: now that
the types are mutually exclusive, that gate excluded exactly the most
overdue contacts.

**Migration is destructive.** `005` adds the index the cooldown lookup needs
plus a partial index for the unread count, then deletes the backlog the old
logic produced — older *unread* duplicates per `(user_id, contact_id, type)`,
keeping the newest. Read rows are untouched and every contact keeps at least
one row. Drop the `DELETE` block if you want the history; the indexes are
the only part the new job needs.

**How to test.** `cd server && npm test` runs the pure decision logic
(`src/jobs/reminderRules.js`, split out of the job precisely so it imports
nothing — no DB, no .env, no `npm install` needed). For anything
DB-dependent, `npm run notifications-doctor` dry-runs the real job against
real data and prints, per contact, whether it would fire and why not if not
(snoozed / cooling down / not due). Add `-- --run` to execute for real
instead of waiting for the 06:00 cron, and `-- --reset <email>` to clear a
user's notification rows so cooldowns don't block a repeat run.
`generateNotifications({ dryRun: true })` is what backs the dry run.

**Verified** by stubbing the DB layer and replaying the job over simulated
days against both the old and new versions (no Postgres to hand). One stale
weekly contact over 30 daily runs: 30 rows / 30 pushes before, 5 / 5 after.
Single run past both thresholds: two types before, one after. Ten runs while
snoozed: 10 pushes before, 0 after. Also covered snooze expiry resuming,
calling someone silencing them for the following week, and cooldown spacing
matching frequency (7 / 14 / 30 days).

**Not addressed — next up.** `reminder_time`, `preferred_call_time`,
`reminder_tone` and `notification_frequency` are all persisted and patchable
but read by nothing; cron is hard-coded `0 6 * * *` in server time. There is
no timezone column anywhere, which is the blocker — Render runs UTC, so
"06:00" is 07:00 in Lagos and 23:00 the previous night in LA. After that:
occasion reminders (`occasions.ts` computes birthdays client-side and they
never notify), a daily cap with batching, quiet hours / Focus Mode, and
richer push payloads (`sw.js` already reads `data.url`; the server never
sends one, so tapping a reminder focuses the app instead of opening the
contact).

---

## 2026-08-28 (d) — Added end-user guide

Added `USER_GUIDE.md` at the repo root: a plain end-user walkthrough of the
app itself (accounts, adding/importing contacts, the Dashboard's daily
suggestion queue, conversation starters, Stats, Settings, notifications,
delete-undo, and the MCP/OAuth consent screen), plus a short "known
limitations" list pulled from the feature-ideas backlog below. This is
separate from `README.md` (local dev setup) and `DEPLOYING.md`
(Vercel/Render deploy) — neither of those explain how to use the app once
it's running, which this fills in.

No app code changed.

---

## 2026-08-28 (c) — Vercel/Render deploy review

Reviewed the split-hosting path again. The 2026-08-27 (b) pass had already
covered `trust proxy`, cookie `SameSite` derivation, the `prestart` script
and `engines`. Five gaps remained; four are now fixed in code.

**1. Postgres SSL (`server/src/db.js`).** No `ssl` option was set. Managed
Postgres presents a cert signed by the provider's own CA, so `pg` rejects
it with `SELF_SIGNED_CERT_IN_CHAIN` — which reads like the database is
unreachable, not like a TLS problem. Now detects `sslmode=require` in the
connection string and relaxes verification for that case only; local
`postgres://localhost/...` is untouched. `DATABASE_SSL_STRICT=true` keeps
full verification for anyone supplying a CA via `NODE_EXTRA_CA_CERTS`.
Render's *internal* URL needs none of this and is still the better choice.

**2. Cold starts vs the request timeout (`src/lib/api.ts`).** The 15s
timeout from (a) is right for a LAN and wrong for a free Render instance,
which sleeps after ~15 min idle and takes 30–60s to wake — the first
request after a quiet period would time out on a perfectly healthy deploy.
The default is now derived from the resolved API host: 15s local, 60s
remote. `VITE_REQUEST_TIMEOUT_MS` still overrides. Floor is still ~6s (the
DB pool's own 5s timeout); below that the client races the server and
hides real error messages.

**3. SPA rewrites (`vercel.json`, new).** `BrowserRouter` with no
catch-all meant a hard refresh on `/auth`, `/contacts` or `/oauth/consent`
returned Vercel's 404. `/oauth/consent` matters most — the MCP OAuth flow
redirects the browser straight to it. Rewrites everything except
`/assets/*`, so Vite's hashed files are still served as static assets
(verified: 8/8 path cases).

**4. Missing `VITE_API_URL` in a production build (`src/lib/api.ts`).**
The resolver's fallback is the page's own host on port 4000 — correct in
dev, never correct once deployed. Vite inlines env vars at build time so
this can't be fixed at runtime; the bundle has to be rebuilt. Now logs an
explicit error saying exactly that.

**5. Cross-site cookies — NOT fixable in code, and the likeliest
breakage.** `*.vercel.app` → `*.onrender.com` forces `SameSite=None`,
which browsers treat as a third-party cookie. Brave and Safari block those
by default; Chrome is phasing them out. Where blocked: login returns 200,
the cookie is dropped, the next call 401s, and the app appears to sign in
and immediately sign out. The WebSocket fails identically — it reads the
same `kk_at` cookie on the upgrade request.

The (b) entry framed `None` as "works, weaker CSRF". That understates it:
in two major browsers it does not work at all. `checkCookieConfig()` now
says so at startup and names the fix — put both on subdomains of one owned
domain (`app.` + `api.wyntek.tech`) and set `COOKIE_DOMAIN=.wyntek.tech`,
which gets back to `SameSite=Lax`. `*.vercel.app` and `*.onrender.com` are
both on the Public Suffix List, so `COOKIE_DOMAIN` cannot bridge them.

Verified by booting with each config: split hosting prints the warning and
resolves `SameSite:none`; the custom-domain config resolves
`SameSite:lax/Secure:true/Domain:.wyntek.tech` and prints nothing.

**Deliberately not fixed: wildcard `CORS_ORIGIN` for preview deploys.**
Each Vercel preview gets a unique URL that isn't in the allow-list, so
previews 403. A `https://*.vercel.app` wildcard would fix that, but
`CORS_ORIGIN` is paired with `credentials: true` — a wildcard over a domain
anyone can deploy to would let any Vercel app make authenticated requests
with a user's cookies. Not worth it for preview convenience.

Full checklist with env var tables and post-deploy curl checks: `DEPLOYING.md`.

---

## 2026-08-28 (b) — Confirmed: stale VITE_API_URL baked into a running Vite

The improved error from (a) named the address, which settled it. The app
was loaded from `192.168.1.162:8080` and calling `192.168.0.171:4000` — a
different subnet entirely. `server/.env` was already correct
(`CORS_ORIGIN` listed `192.168.1.162:8080`), so the backend was fine.

**Root cause: Vite inlines `import.meta.env` at dev-server START, not at
page load.** The backend had been restarted since the DHCP change, so its
`predev` hook re-synced `server/.env`. The frontend dev server had not, so
it kept serving the address from the old network. `sync-lan-ip.mjs` cannot
help here — it had already written the correct value to `.env`; the
running process simply never re-read it.

So the (a) hypothesis (a virtual adapter winning IP detection) was wrong.
Those hardening changes are still worth keeping — they close a real hole —
but this was the actual failure.

**Fix: stop trusting the baked value when the browser knows better.**
`resolveApiUrl()` in `src/lib/api.ts` compares the configured host against
`window.location.hostname`. When both are LAN/localhost addresses and they
disagree, the page's own host wins — the browser reached this page
somehow, and the backend is on the same machine, so that address is
correct by construction. This also fixes the long-standing "works on the
dev machine, not from my phone" case where `VITE_API_URL` says
`localhost`.

Real domains are never rewritten, so Vercel/Render deploys are unaffected.
`VITE_API_URL_EXACT=true` opts out for a genuine split-machine setup.
`VITE_WS_URL` goes through the same resolver. 13 resolver cases covered,
plus an end-to-end run over real sockets: stale address → ECONNREFUSED,
same config through the resolver → 200.

**Practical upshot:** a LAN IP change no longer requires restarting the
frontend dev server. The console still warns when the correction fires, so
the stale `.env` is visible rather than silently papered over.

---

## 2026-08-28 (a) — "signal is aborted without reason" on sign-in

That string is not ours. It's the browser's default `DOMException` message
when an `AbortController` cancels a `fetch`. `api.ts` put an 8s timeout on
every request, and `errorMessage()` returned `error.message` verbatim, so a
backend that didn't answer in 8s surfaced as a toast describing *the
mechanism that cancelled the request* rather than anything actionable.

**Ruled out by measurement**, so nobody re-checks them: bcryptjs at cost 12
is ~335ms (hash and compare both). A dead Postgres returns
`{"error":"Could not sign in"}` in 33ms, not a hang. A rejected CORS origin
fails immediately too. None of these can produce a multi-second hang.

A hang means the TCP connection is never accepted *and* never refused —
the signature of an address where nothing is listening and a firewall is
dropping packets rather than sending a reset. That points at `VITE_API_URL`.

**Most likely root cause: `detectLanIp()` in `scripts/sync-lan-ip.mjs` could
pick a virtual adapter.** It took the first `192.168.x` it found, in
`os.networkInterfaces()` order. A VirtualBox host-only adapter
(`192.168.56.1`) or a Windows ICS/hotspot adapter (`192.168.137.1`) sorts
equal to the real Wi-Fi address, so either could win. Vite binds every
interface, so the app still *loads* over the real LAN IP while every API
call goes to an address nothing answers on — and hangs until the client
timeout. Silent, and it looks like an app bug.

**What changed:**

- `src/lib/api.ts` — failures are now `ApiError` (server answered non-2xx)
  or `NetworkError` (`kind: 'timeout' | 'unreachable'`), with the address
  actually tried in the message, plus a fuller diagnosis to the console in
  dev builds. Timeout 8s → 15s, and configurable via
  `VITE_REQUEST_TIMEOUT_MS`. **Never set it below ~6s**: the DB pool gives
  up at 5s (`connectionTimeoutMillis`) and returns a real error, so a
  tighter client timeout races the server and replaces the real message
  with a generic one. Also: trailing slashes in `VITE_API_URL` are now
  stripped, refresh failures resolve `false` instead of throwing (a
  speculative refresh must not replace the caller's real error), and empty
  bodies no longer blow up `res.json()`.
- `src/lib/utils.ts` — `errorMessage()` backstops any abort/`Failed to
  fetch` that doesn't go through `api.ts`.
- `scripts/sync-lan-ip.mjs` — detection now asks the OS which interface
  carries the default route (UDP `connect()` sends no packets; it just
  makes the kernel run its routing table), which is authoritative rather
  than a guess. Name/range heuristics remain as the offline fallback, now
  excluding vboxnet/vEthernet/hotspot/APIPA. `LAN_IP=<addr>` overrides
  everything. Rejected candidates are printed, so a wrong pick is visible
  in the dev-server output instead of showing up as a mystery timeout.
- `scripts/sync-lan-ip.mjs` — **separate bug**: `mergeCorsOrigin()` kept
  *only* the two localhost origins, silently deleting any hand-added one
  (a deployed frontend, a second test device) on every dev-server start.
  Now drops only stale IP-literal origins.
- `server/src/index.js` — CORS rejections were a 500 with an HTML stack
  trace; now a 403 JSON plus a log line naming the origin, the allow-list,
  and the fix. Added a JSON error handler so 5xx stops returning HTML that
  `api.ts` can't parse.

**Note:** the LAN-IP diagnosis is inference, not confirmation — the `.env`
files aren't in version control, so the actual bad value was never seen.
The new output settles it either way: the toast names the address it tried,
and `[sync-lan-ip]` lists the candidates it rejected.

**Stale docs corrected:** the section below claims `npm start` syncs the LAN
IP. It doesn't — `prestart` was deliberately removed on 2026-08-27 (b) so
Render deploys wouldn't bake a container's internal 10.x address into
`APP_URL`. Only `npm run dev` syncs.

---

## 2026-08-27 (e) — Delete-menu icon bug + delete modal too wide on mobile

`ContactCard.tsx` was importing lucide's `MoveVertical` (↕) aliased as
`MoreVertical` — the dropdown trigger button was showing the wrong icon the
whole time. Fixed to import the actual `MoreVertical` (⋮) icon. Also the
delete confirmation `AlertDialogContent` used the base component's default
`w-full`, which spans edge-to-edge with no side margin on mobile; scoped a
`w-[calc(100%-2rem)] max-w-sm` on this instance so it stays narrow.

---

## 2026-08-27 (d) — Undo-on-delete for contacts

Picked off the feature-ideas list. `deleteContact` in `useContacts.ts` no
longer calls the API immediately: it optimistically removes the contact from
local state and shows a sonner toast ("`<name>` deleted") with an Undo action,
holding the real `DELETE /contacts/:id` in a 5s `setTimeout`. Undo clears the
timeout and re-adds the contact to state — no refetch needed. A realtime
refetch during the undo window won't resurrect the contact (pending IDs are
filtered out of `fetchContacts`'s result), and pending deletes are flushed on
unmount instead of silently dropping. `ContactCard`'s confirm dialog copy
updated since delete is no longer irreversible.

Remaining feature ideas untouched: Web Push notifications, calling streaks,
duplicate-contact detection on import, click-to-call/WhatsApp from the
dashboard card.

---

## 2026-08-27 (c) — "Still didn't send" was actually a delivery failure

The doctor came back clean: key valid, `mail.send` present, live send accepted
with a 202 and a message id. So the API path was never the problem.

**Root cause: `EMAIL_FROM` was `wynteknologies@gmail.com`.** You can't send as
a gmail.com address through SendGrid. gmail.com publishes SPF/DKIM/DMARC
records that don't list SendGrid's servers, and you can't change them because
you don't own the domain. Every message fails DMARC alignment, so the
receiving provider junks or refuses it. SendGrid still returns 202, which is
what made this look like "not sending" rather than "not delivering".

Single Sender Verification does *not* fix this — it only proves you control
the inbox, not the domain. It's why the send was accepted at all.

Sending from a Gmail address *to* a Gmail address is the worst possible test:
mail claiming to be from a Gmail user but arriving from an outside server is
the exact shape of a spoofing attack.

**Fix:** SendGrid > Settings > Sender Authentication > Authenticate Your
Domain, add the CNAMEs to the wyntek.tech DNS, then
`EMAIL_FROM="Kall Konnect <noreply@wyntek.tech>"`.

`checkEmailConfig()` now warns on ~20 free-mail domains (gmail, yahoo,
outlook, icloud, proton, gmx…) at startup and in the doctor. It's non-fatal by
design: SendGrid accepts these, so nothing can detect it at send time. The
doctor also now explains what each Activity Feed status means, since a 202
alone tells you nothing about delivery.

---

## 2026-08-27 (b) — Made it deployable to Vercel + Render

Four things would have broken a split Vercel (frontend) / Render (backend)
deploy. None were email-specific, but the first two look exactly like
"emails stopped sending".

**1. `prestart` ran the LAN-IP script on every boot.** `scripts/sync-lan-ip.mjs`
detects the *container's* internal 10.x address on Render and writes it into
`APP_URL`/`CORS_ORIGIN`, baking a dead address into password-reset links. It
also scaffolds `server/.env` from `.env.example`, dragging in placeholder
values (`EMAIL_FROM=you@example.com`) for anything not set in the dashboard.
And if Render's root directory is `server/`, `../scripts/` doesn't exist, so
`npm start` exits non-zero and the deploy fails outright.
Fixed twice over: the script now no-ops when it sees `NODE_ENV=production` or
a platform marker (`RENDER`, `VERCEL`, `CI`, Fly, Heroku, Cloud Run), and the
`prestart` hook is gone entirely — `npm start` is the production command, so
the LAN sync now only hangs off `predev` (with `|| true` so a missing script
can't break dev either).

**2. No `app.set('trust proxy')`.** Behind Render's load balancer `req.ip` is
the proxy's address for every request, so all users share one rate-limit
bucket. Measured with 10 distinct users through one proxy hop against the
5/hour forgot-password limit:

    trust proxy OFF   5/10 distinct users blocked
    trust proxy = 1   0/10 distinct users blocked

So in production the 6th password reset from *anyone* would 429 and send no
email. express-rate-limit v7 also raises `ERR_ERL_UNEXPECTED_X_FORWARDED_FOR`.
Now set from `env.trustProxy`, auto-detecting to 1 on Render / in production.

**3. Cookies were hardcoded `sameSite: 'lax'`.** `*.vercel.app` →
`*.onrender.com` is cross-site, so the browser never sends Lax cookies on the
API's XHR calls and login silently does nothing. `lib/cookies.js` now derives
the policy:

    COOKIE_DOMAIN set        -> lax   (shared parent domain, same-site)
    HTTPS, no COOKIE_DOMAIN  -> none  (split hosting)
    plain http dev           -> lax

`SameSite=None` forces `Secure` on, since browsers reject that pairing and
drop the cookie with no error. Both `vercel.app` and `onrender.com` are on
the Public Suffix List, so `COOKIE_DOMAIN` can't bridge them — a custom
domain (`app.` + `api.` on one parent) is the only route back to Lax, which
is worth doing: under `None` the double-submit CSRF token is the sole CSRF
defence. `COOKIE_SAMESITE` overrides the derivation.

**4. No `engines`.** Pinned `node >=20` in both package.json files —
the code needs global `fetch` and `AbortSignal.timeout`.

Startup now prints resolved config (env, trustProxy, cookie policy, CORS
origins, APP_URL) and flags cookie problems alongside the email ones.

**Deploy settings** are documented at the bottom of `server/.env.example`.
The one people get wrong: `APP_URL` must be the public *frontend* URL, since
that's what reset links are built from.

---

## 2026-08-27 — Password reset / verification emails "not sending"

**Symptom:** a valid `SENDGRID_API_KEY` set, but no mail arriving, and no
error anywhere.

**Why it was invisible:** both auth routes swallow email errors by design —
a dead mailer must not block signup, and surfacing errors from
`/forgot-password` would turn it into an account-enumeration oracle. So the
UI reported success in *every* failure mode, and the only trace was one
`console.error` that was easy to scroll past.

**What changed** (none of it weakens the enumeration defence — the HTTP
response is still generic; the difference is all server-side logging):

- `env.js` now loads `server/.env` by explicit path instead of via
  `dotenv/config`, which resolved against `process.cwd()`. Starting from the
  repo root silently loaded the root (Vite-only) `.env`, so the key came back
  empty and email fell into console/dev mode with no signal.
- `env.js` trims `SENDGRID_API_KEY` and `EMAIL_FROM`. A trailing space or a
  newline from a wrapped paste survives dotenv and breaks the Bearer header,
  which reads as "the key is wrong".
- `lib/email.js` gained `checkEmailConfig()`, which refuses to send on a
  known-bad config (placeholder `EMAIL_FROM`, malformed key) and explains
  why. 401/403/429 responses now map to actionable messages instead of a
  bare status code. Transient failures (429/5xx/network) retry 3x with
  backoff; config failures don't, since retrying can't help.
- `index.js` runs that same check at boot, so a broken config announces
  itself on startup rather than at first password reset.
- `routes/auth.js` splits token issuance from sending, so the log
  distinguishes "`auth_tokens` doesn't exist, run `npm run migrate`" from
  "SendGrid rejected the send" — these previously looked identical.
- Dev-mode email logging now prints the reset/verify link on its own line
  instead of burying it in an HTML dump.
- New `npm run email-doctor` (`server/scripts/email-doctor.mjs`): checks the
  key's scopes, cross-references `EMAIL_FROM` against verified senders,
  scans the four suppression lists, and optionally sends a live test through
  the app's own `sendEmail()`. Add a recipient to send:
  `npm run email-doctor -- you@gmail.com`.

**The two most likely root causes**, both of which the doctor names directly:
the API key lacks the `mail.send` scope (a Restricted Access key without it
authenticates fine and 403s every send), or `EMAIL_FROM` doesn't exactly
match a verified Single Sender. Both are now documented in `.env.example`.

**Unrelated but worth knowing:** `scripts/sync-lan-ip.mjs` rewrites `APP_URL`
to the current LAN IP on every `npm start`, so reset links get baked with
that IP and won't open from outside the network even when the mail arrives.

## LAN IP keeps changing when testing from your phone?

DHCP reassigns this machine's IP whenever it reconnects to a network —
that's what kept breaking `VITE_API_URL`/`CORS_ORIGIN`. `npm run dev`
(both root and `server/`) auto-detects the current LAN IP and rewrites both
`.env` files before starting, via `scripts/sync-lan-ip.mjs`. You shouldn't
need to hand-edit an IP into either `.env` again. Run it standalone any
time with `npm run sync-ip`, and pin it with `LAN_IP=192.168.1.50 npm run dev`
if autodetection picks the wrong interface.

**`npm start` does NOT sync** — the `prestart` hook was removed on
2026-08-27 (b) so Render deploys wouldn't bake a container's internal 10.x
address into `APP_URL`. That's deliberate; use `npm run dev` locally.

This masks the symptom, not the cause — for a permanent fix, set a DHCP
reservation (a.k.a. static lease) for this machine in your router's admin
page, so its IP stops changing at all.

## 2026-08-26 — Ripped Supabase out, rebuilt on plain Postgres + Express

**What happened:** Full backend migration off Supabase. Auth, RLS,
Realtime, and the edge function/OAuth-provider setup are gone, replaced
by `server/` (Express + plain Postgres). See `server/README.md` for the
architecture table and setup steps. Frontend hooks/pages rewired to a new
`lib/api.ts` fetch client + `lib/auth-context.tsx` + `lib/realtime.ts`
(WebSocket). Scope decisions made along the way: full auth parity
(email/password + Google + MCP OAuth), and WebSocket realtime kept
rather than dropped to plain refetch.

Also fixed two real timezone bugs during the original bug-fix pass and
one more caught mid-migration:
- Birthday/anniversary/special-date save path was off by one day for
  positive-UTC-offset users (`toLocalDateString`/`parseLocalDate` in
  `src/lib/utils.ts` fix this).
- `pg`'s default driver parsed `DATE` columns into JS `Date` objects,
  which serialized as full UTC timestamps instead of bare `YYYY-MM-DD`
  strings — broke the frontend's date parsing contract. Fixed in
  `server/src/db.js` by overriding the type parser for OID 1082.
- CORS default port mismatch (`vite.config.ts` uses 8080, old default
  `CORS_ORIGIN` assumed Vite's 5173 default) caused "Failed to fetch" on
  fresh setups. `CORS_ORIGIN` now takes a comma-separated list.

### Known gaps / worth fixing soon

_All five items below were fixed as part of an auth-hardening pass._

- ~~No "forgot password" flow.~~ **Fixed.** `POST /auth/forgot-password` +
  `POST /auth/reset-password`, tokens in the new `auth_tokens` table
  (hashed, 1hr TTL), emailed via SendGrid. `SENDGRID_API_KEY` unset →
  logs the email to the console instead of sending, so this still works
  with zero config in dev.
- ~~No rate limiting on `/auth/login` or `/auth/register`.~~ **Fixed.**
  `server/src/middleware/rateLimit.js` — 10 attempts/15min on login+register,
  5/hour on forgot-password.
- ~~Access tokens live in `localStorage`.~~ **Fixed.** Auth now lives in
  httpOnly cookies (`kk_at`/`kk_rt`), set/read via
  `server/src/lib/cookies.js`. Added double-submit CSRF protection (`kk_csrf`
  cookie + `X-CSRF-Token` header) since cookie-based sessions need it —
  see `requireAuth.js`. Frontend `api.ts` now sends `credentials: 'include'`
  everywhere instead of an `Authorization` header. WebSocket auth
  (`ws.js`) reads the same cookie off the upgrade request instead of a
  `?token=` query param.
- ~~No email verification on signup.~~ **Fixed.** New `users.email_verified`
  column (Google sign-ins are marked verified immediately; existing
  accounts backfilled true). `POST /auth/verify-email`,
  `POST /auth/resend-verification`. Not enforced anywhere yet — login isn't
  gated on it, by design, to avoid locking anyone out. Settings shows a
  "resend link" banner when unverified.
- ~~`auto_add_calendar_reminders` setting persists but does nothing.~~
  **Fixed, pragmatically.** We don't have full calendar OAuth everywhere, so
  real two-way calendar sync is a bigger feature, not a gap-fix. Instead:
  when this is on, a `planned_call` reminder now emails the user a `.ics`
  invite (works with Google/Apple/Outlook — one-tap "add to calendar" from
  the email). See `generateNotifications.js` + `lib/ics.js`.

**New env vars to set** (see `server/.env.example`): `SENDGRID_API_KEY`,
`EMAIL_FROM`, `COOKIE_SECURE` (leave `false` for LAN/http dev, `true` once
on HTTPS), `COOKIE_DOMAIN` (leave blank outside of a real prod domain).
Run `npm run migrate` to pick up `003_auth_hardening.sql`.

### Feature ideas (not started)

> Notification-related items have been consolidated into "NEXT UP —
> notifications" at the top of this file. What remains below is everything
> else.

- ~~Real push notifications (Web Push)~~ — DONE. Web Push is implemented
  (`server/src/lib/push.js`, `server/src/routes/push.js`, `public/sw.js`,
  `src/lib/push.ts`). This entry was stale. Remaining polish is tracked in
  the 2026-09-02 entry above: payload deep-links, action buttons, icons.
- Calling streaks ("called Mom every week for 6 weeks") — light
  gamification fitting the habit-maintenance angle of the app.
- Duplicate contact detection on import (fuzzy name+phone match) —
  natural next step given the import dialog already exists.
- Click-to-call / one-tap WhatsApp directly from the dashboard card
  instead of requiring a trip to the Contacts page.
- Undo-on-delete — deleting a contact is currently immediate and
  permanent; a 5-second "Undo" toast would prevent accidental taps from
  being unrecoverable.
- Search/filter on the Contacts page, if not already present — worth
  checking.
