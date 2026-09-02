// Notification copy. Pure — no imports, no DB, no clock of its own — so it
// can be unit-tested and so `npm test` stays dependency-free.
//
// Two things vary the wording:
//   * scenario  — why we're nudging (occasion, follow-up, first call, ...)
//   * tone      — warm | casual | friendly, taken from the CONTACT, not a
//                 global setting, so a nudge about your mother doesn't read
//                 like a nudge about a colleague.
//
// Tone mirrors the frontend's TemplateTone (src/data/templates.ts) rather
// than user_preferences.reminder_tone, which is a different and unused
// vocabulary (friendly|professional|casual). See HANDOVER for why.

export const TONES = ['warm', 'casual', 'friendly'];

/** Same mapping the frontend uses in data/templates.ts. */
export const DEFAULT_TONE_FOR_RELATIONSHIP = {
  family: 'warm',
  friend: 'casual',
  colleague: 'friendly',
  acquaintance: 'friendly',
};

export function toneForContact(contact) {
  // contact.template_tone is only ever set when the user picked one
  // explicitly in the Templates dialog, so it outranks the default.
  if (TONES.includes(contact?.template_tone)) return contact.template_tone;
  return DEFAULT_TONE_FOR_RELATIONSHIP[contact?.relationship] ?? 'friendly';
}

// ── The user's own name ───────────────────────────────────────────────────

const NAME_JUNK = new Set([
  'info', 'admin', 'hello', 'hi', 'mail', 'email', 'contact', 'support',
  'noreply', 'no-reply', 'test', 'user', 'me', 'team',
]);

function titleCase(word) {
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

/**
 * First name to greet the user by.
 *
 * users.display_name is nullable and never required at signup (Google
 * sign-in supplies one, email signup does not), so this falls back to the
 * email local part: "joy.okafor@x.com" -> "Joy". Returns null rather than
 * something embarrassing when there's nothing usable — callers drop the
 * greeting entirely in that case, which reads fine.
 */
export function greetingName({ displayName, email } = {}) {
  const fromDisplay = (displayName ?? '').trim().split(/\s+/)[0];
  if (fromDisplay && /[a-z]/i.test(fromDisplay)) return titleCase(fromDisplay);

  const local = (email ?? '').split('@')[0] ?? '';
  // "joy.okafor", "joy_okafor", "joy-okafor", "joy23" -> "joy"
  const first = local.split(/[._\-+0-9]+/).filter(Boolean)[0] ?? '';
  if (!first || first.length < 2) return null;
  if (NAME_JUNK.has(first.toLowerCase())) return null;
  if (!/^[a-z]+$/i.test(first)) return null;
  return titleCase(first);
}

// ── Deterministic variation ───────────────────────────────────────────────

/** Small stable string hash. Variation needs to be stable for a given
 * (contact, scenario, day) so the copy doesn't churn if the job is re-run,
 * but different across contacts and days so it doesn't read like a robot. */
export function variantIndex(seed, count) {
  let h = 5381;
  for (let i = 0; i < seed.length; i++) h = ((h << 5) + h + seed.charCodeAt(i)) | 0;
  return Math.abs(h) % Math.max(1, count);
}

// ── Phrasings ─────────────────────────────────────────────────────────────
//
// Each entry is a function of the context so counts and names can be
// interpolated. `g` is the greeting prefix, already punctuated and possibly
// empty — never concatenate a name yourself.

const BODIES = {
  first_call: {
    warm: [
      (c) => `${c.g}you haven't spoken to ${c.name} through here yet. A first call is always the hardest one — and the best one.`,
      (c) => `${c.g}${c.name} is new here. No history to catch up on, just a good excuse to ring.`,
      (c) => `${c.g}${c.name} hasn't heard from you yet. Might be a lovely surprise.`,
    ],
    casual: [
      (c) => `${c.g}you've not called ${c.name} yet. Break the ice?`,
      (c) => `${c.g}${c.name} is sitting in your list unbothered. Give them a ring.`,
      (c) => `${c.g}first call with ${c.name} is still pending. Now's as good a time as any.`,
    ],
    friendly: [
      (c) => `${c.g}you haven't called ${c.name} yet. A quick hello would do it.`,
      (c) => `${c.g}${c.name} is new to your list — worth an introduction call.`,
      (c) => `${c.g}no calls logged with ${c.name} so far. Want to start?`,
    ],
  },

  planned_call: {
    warm: [
      (c) => `${c.g}it's been ${c.days} days since you and ${c.name} spoke. They'd love to hear your voice.`,
      (c) => `${c.g}${c.name} is about due for a catch-up — ${c.days} days since the last one.`,
      (c) => `${c.g}${c.days} days since ${c.name}. A short call still counts.`,
    ],
    casual: [
      (c) => `${c.g}${c.days} days since you called ${c.name}. Give them a shout.`,
      (c) => `${c.g}${c.name} is due a call — it's been ${c.days} days.`,
      (c) => `${c.g}been ${c.days} days since ${c.name}. Ring them?`,
    ],
    friendly: [
      (c) => `${c.g}it's been ${c.days} days since your last call with ${c.name}.`,
      (c) => `${c.g}${c.name} is due for a check-in — ${c.days} days since you last spoke.`,
      (c) => `${c.g}${c.days} days since ${c.name}. Good time for a quick call.`,
    ],
  },

  inactivity: {
    warm: [
      (c) => `${c.g}it's been ${c.days} days since you and ${c.name} last spoke. No guilt — just a nudge.`,
      (c) => `${c.g}${c.name} has been quiet for ${c.days} days. Long gaps close faster than you'd think.`,
      (c) => `${c.g}${c.days} days without ${c.name}. One call is all it takes to pick it back up.`,
    ],
    casual: [
      (c) => `${c.g}it's been ${c.days} days since ${c.name}. Properly overdue now.`,
      (c) => `${c.g}${c.days} days since you spoke to ${c.name}. Time to fix that.`,
      (c) => `${c.g}${c.name} has gone ${c.days} days without hearing from you. Ring them.`,
    ],
    friendly: [
      (c) => `${c.g}it's been ${c.days} days since you spoke with ${c.name}. Worth reconnecting.`,
      (c) => `${c.g}${c.days} days since your last call with ${c.name}.`,
      (c) => `${c.g}${c.name} hasn't heard from you in ${c.days} days.`,
    ],
  },

  follow_up: {
    warm: [
      (c) => `${c.g}your last call with ${c.name} sounded like it needed a second half. Circle back?`,
      (c) => `${c.g}you left something unfinished with ${c.name} last time. Worth picking up.`,
      (c) => `${c.g}the last chat with ${c.name} felt like it wasn't done. Give them a ring.`,
    ],
    casual: [
      (c) => `${c.g}last call with ${c.name} felt unfinished. Round two?`,
      (c) => `${c.g}you and ${c.name} left something hanging. Follow it up.`,
      (c) => `${c.g}that last one with ${c.name} got cut short by the look of it.`,
    ],
    friendly: [
      (c) => `${c.g}your last call with ${c.name} looked like it needed a follow-up.`,
      (c) => `${c.g}there was something left open with ${c.name} last time.`,
      (c) => `${c.g}worth following up on your last conversation with ${c.name}.`,
    ],
  },
};

// Occasions read the same across tones for the day itself — a birthday is a
// birthday — but the lead-up nudge takes the contact's tone.
const OCCASION_BODIES = {
  birthday: {
    today: (c) => `${c.g}it's ${c.name}'s birthday today. A call beats a text.`,
    soon: {
      warm: (c) => `${c.g}${c.name}'s birthday is ${c.when}. Worth planning a proper call.`,
      casual: (c) => `${c.g}heads up — ${c.name}'s birthday is ${c.when}.`,
      friendly: (c) => `${c.g}${c.name}'s birthday is ${c.when}.`,
    },
  },
  anniversary: {
    today: (c) => `${c.g}today is ${c.name}'s anniversary. Worth a call.`,
    soon: {
      warm: (c) => `${c.g}${c.name}'s anniversary is ${c.when}. A call would mean something.`,
      casual: (c) => `${c.g}${c.name}'s anniversary is ${c.when} — don't let it slip.`,
      friendly: (c) => `${c.g}${c.name}'s anniversary is ${c.when}.`,
    },
  },
  special: {
    today: (c) => `${c.g}today is ${c.name}'s ${c.label}. Good reason to call.`,
    soon: {
      warm: (c) => `${c.g}${c.name}'s ${c.label} is ${c.when}. Worth marking with a call.`,
      casual: (c) => `${c.g}${c.name}'s ${c.label} is ${c.when}.`,
      friendly: (c) => `${c.g}${c.name}'s ${c.label} is ${c.when}.`,
    },
  },
};

// Days when nobody is actually due. The app's promise is a daily prompt, so
// going silent on a quiet day breaks the habit it's trying to build — but
// there's no one to name, so this stays short and doesn't invent urgency.
const NUDGE_BODIES = [
  (c) => `${c.g}nobody's overdue today — you're on top of it. A call you don't owe anyone is usually the best kind.`,
  (c) => `${c.g}everyone's been heard from recently. Nothing needed today.`,
  (c) => `${c.g}your list is all caught up. If someone comes to mind anyway, that's reason enough.`,
  (c) => `${c.g}no one's waiting on a call today. Quiet week, well kept.`,
];

const STREAK_BODIES = [
  (c) => `${c.g}that's ${c.streak} days in a row you've reached out to someone. Quietly impressive.`,
  (c) => `${c.g}${c.streak} straight days of keeping in touch. That's a real habit now.`,
  (c) => `${c.g}${c.streak} days running. Whatever you're doing, it's working.`,
];

const TITLES = {
  first_call: (c) => `Say hello to ${c.name}`,
  planned_call: (c) => `Time to call ${c.name}`,
  inactivity: (c) => `Haven't connected with ${c.name} lately?`,
  follow_up: (c) => `Pick up where you left off with ${c.name}`,
  occasion: (c) =>
    c.occasionType === 'birthday'
      ? (c.daysUntil === 0 ? `${c.name}'s birthday is today 🎂` : `${c.name}'s birthday is ${c.when} 🎂`)
      : c.occasionType === 'anniversary'
        ? (c.daysUntil === 0 ? `${c.name}'s anniversary is today` : `${c.name}'s anniversary is ${c.when}`)
        : (c.daysUntil === 0 ? `${c.name}'s ${c.label} is today` : `${c.name}'s ${c.label} is ${c.when}`),
  streak: (c) => `${c.streak}-day streak 🔥`,
  nudge: () => `All caught up`,
};

/** notifications.type values, one per scenario. Must stay in sync with the
 * CHECK constraint (migration 006) and with the icon map in
 * src/components/NotificationsBell.tsx. */
export const SCENARIO_TYPES = [
  'planned_call', 'inactivity', 'occasion', 'follow_up', 'first_call', 'streak', 'nudge',
];

export function whenLabel(daysUntil) {
  if (daysUntil === 0) return 'today';
  if (daysUntil === 1) return 'tomorrow';
  return `in ${daysUntil} days`;
}

/**
 * Builds the title and message for one reminder.
 *
 * `ctx` carries everything the phrasings might interpolate: contact, days,
 * userName, tone, occasion details, streak. `dayKey` seeds the variation so
 * re-running the job on the same day produces identical copy.
 */
export function buildReminder(scenario, ctx) {
  const name = ctx.contact?.name ?? 'them';
  const tone = ctx.tone ?? toneForContact(ctx.contact);
  const g = ctx.userName ? `Hey ${ctx.userName}, ` : '';
  const when = whenLabel(ctx.daysUntil ?? 0);

  const view = {
    g,
    name,
    days: ctx.days,
    streak: ctx.streak,
    label: ctx.label,
    when,
    daysUntil: ctx.daysUntil,
    occasionType: ctx.occasionType,
  };

  const seed = `${ctx.contact?.id ?? 'user'}|${scenario}|${ctx.dayKey ?? ''}`;

  let message;
  if (scenario === 'occasion') {
    const set = OCCASION_BODIES[ctx.occasionType] ?? OCCASION_BODIES.special;
    message = ctx.daysUntil === 0 ? set.today(view) : (set.soon[tone] ?? set.soon.friendly)(view);
  } else if (scenario === 'nudge') {
    message = NUDGE_BODIES[variantIndex(seed, NUDGE_BODIES.length)](view);
  } else if (scenario === 'streak') {
    message = STREAK_BODIES[variantIndex(seed, STREAK_BODIES.length)](view);
  } else {
    const byTone = BODIES[scenario];
    if (!byTone) throw new Error(`Unknown reminder scenario: ${scenario}`);
    const variants = byTone[tone] ?? byTone.friendly;
    message = variants[variantIndex(seed, variants.length)](view);
  }

  // Only one contact is named per day (see pickDailyContact), so say plainly
  // that there are others rather than silently dropping them.
  if (ctx.alsoDue > 0 && scenario !== 'streak' && scenario !== 'nudge') {
    message += ctx.alsoDue === 1 ? ' One other person is due too.' : ` ${ctx.alsoDue} others are due too.`;
  }

  // A live streak colours other reminders too, rather than firing its own
  // notification every morning — see reminderRules.chooseScenario.
  if (scenario !== 'streak' && ctx.streak >= 3) {
    message += ` You're on a ${ctx.streak}-day run.`;
  }

  // Every phrasing is written to follow "Hey Joy, ", so when there's no
  // name to greet (display_name null and the email local part unusable) the
  // sentence would otherwise open lowercase.
  if (!g) message = message.charAt(0).toUpperCase() + message.slice(1);

  return { type: scenario, title: TITLES[scenario](view), message };
}
