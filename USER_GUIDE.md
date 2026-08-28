# Kall Konnect — User Guide

Kall Konnect (also called Relationship Assistant / RA) is a contact-based
check-in app. It helps you stay in touch with the people you care about by
suggesting who to call, giving you a conversation starter, and remembering
what you last talked about — instead of letting relationships go quiet
because texting is easier than calling.

This guide covers how to use the app day to day. For installing or
deploying it, see `README.md` (local setup) and `DEPLOYING.md`
(Vercel + Render).

---

## 1. Creating an account

Open the app and sign up with email/password, or with Google/Apple if
those are configured for your deployment. A verification email is sent on
signup; login isn't blocked while you're unverified, but Settings will
show a banner with a "resend link" option until you confirm.

Forgot your password? Use "Forgot password" on the sign-in screen — a
reset link is emailed to you (valid for 1 hour).

---

## 2. Adding contacts

From **Contacts**, add people one at a time or bring in your whole list:

- **Add Contact** — name, relationship (friend/family/colleague/etc.),
  phone number, and optionally a WhatsApp number, Instagram username, and
  Snapchat username if they differ from the phone contact. Pick which call
  platforms should show up as quick-action buttons for that person.
- **Import Contacts** — bulk-add contacts instead of entering each one by
  hand.
- **Search** the list, or filter to **★ Favorites** to find someone
  quickly.

Kall Konnect never overwrites your phone's native contacts — it's a
separate list layered with reminders, notes, and call history.

---

## 3. The Dashboard — who to call today

The Dashboard is the main screen. It picks people for you to reach out
to, based on how long it's been since your last call and each contact's
call frequency:

- **Today's suggestion** is shown front and center, with a conversation
  starter already written for you.
- **Upcoming** shows the next several people in the queue (up to 7 — one
  per day of the week).
- **Upcoming occasions** — birthdays, anniversaries, and other special
  dates you've saved surface here a few days ahead so you don't miss them.
- **Streak** — the app tracks your current calling streak and shows it at
  the top.

For each suggested contact you can:

- **Call, WhatsApp Call, Instagram Call, or Snapchat Call** — tapping a
  platform button opens that app directly with the contact pre-filled.
  Only the platforms you enabled for that contact appear.
- **Not now** — skip this person for today; they'll resurface tomorrow.
- **Reschedule** — snooze them for a specific number of days (quick
  options: 1, 3, 7, 14) instead of just today.
- **Favorite** — star a contact so they're prioritized and easy to filter
  to later.

After you make a call, the app prompts you to jot down 2–3 quick notes
about the conversation. These are saved to that contact's history so next
time you call, you (or the built-in conversation starter) can reference
what you last talked about.

---

## 4. Conversation starters

Every suggested contact comes with a friendly opener suited to your
relationship with them (friend, family, colleague, etc.) — e.g. a simple
check-in question, or a follow-up referencing something from your notes
if the app detects your last conversation left something open. You can:

- Use the suggested starter as-is.
- Pick a different **tone** for a contact's starters.
- Write and save your own **custom template** for a specific contact,
  which is then used instead of the generated ones.

---

## 5. Stats

The **Stats** page is your relationship dashboard:

- Calls made this week / this month
- Weekly average
- Total contacts in your network
- Current streak, with an encouraging note as it grows
- Most-contacted people and any overdue/pending check-ins

It's meant to feel motivating rather than like a task list — think progress
tracker, not KPI report.

---

## 6. Settings

- **Profile** — your display name.
- **Notifications** — turn reminders on/off and choose how often you're
  nudged (daily/weekly/monthly). Enabling notifications requests
  permission for push notifications in your browser.
- **Default call frequency** — how often, by default, a newly added
  contact should come back into your rotation (weekly / bi-weekly /
  monthly). Each contact can also be set individually.
- **Preferred call time** — morning / afternoon / evening / anytime, used
  to time reminders.
- **Calendar Integration** — connect Google or Apple Calendar. When
  enabled, a planned call sends you a `.ics` invite by email so it lands
  on your calendar with one tap — there isn't full two-way calendar sync.
- **Theme** — switch to dark mode.
- **Log out**.

There's no separate "Focus Mode" toggle at the moment — pausing reminders
for a busy stretch is done per-contact via **Reschedule** (snooze).

---

## 7. Notifications

The bell icon shows reminders such as "It's been a while since you heard
from X" or an upcoming birthday. Notifications currently surface while
the app is open in a browser tab (via a live connection to the server);
they are not yet delivered as push notifications to a closed browser or
phone lock screen — see `HANDOVER.md` under "Feature ideas" if that
matters for your deployment.

---

## 8. Deleting a contact

Deleting a contact shows an "Undo" option for a few seconds before it's
actually removed, in case you tap it by mistake.

---

## 9. MCP / OAuth consent screen

If you see a "Kall Konnect wants to access..." consent screen, that's the
app acting as an OAuth provider for an MCP (Model Context Protocol)
client — e.g. an AI assistant asking for permission to read/manage your
contacts and reminders on your behalf. Only approve it if you recognize
and trust the requesting app.

---

## Known limitations (as of this build)

- No real push notifications yet — the bell only works while a tab is
  open.
- No fuzzy duplicate-contact detection on import.
- Calendar integration is one-way (email invite), not live two-way sync.

See `HANDOVER.md` for the full technical history and outstanding items.
