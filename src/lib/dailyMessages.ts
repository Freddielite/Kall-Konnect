import { toLocalDateString } from '@/lib/utils';

/**
 * Deterministic "message of the day" picking - a stable hash of
 * (today's date + a seed identifying which message slot) modulo the
 * pool size. Same day + same slot always picks the same variant (so it
 * doesn't flicker between renders or navigations), but a different day
 * - or, for the greeting, a different time-of-day band - picks a
 * different one, so nothing goes stale from being the same string
 * forever.
 */
function pickForDay<T>(pool: readonly T[], seed: string, date: Date = new Date()): T {
  const key = `${toLocalDateString(date)}:${seed}`;
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  }
  return pool[hash % pool.length];
}

export type TimeBand = 'morning' | 'afternoon' | 'evening';

export function getTimeBand(date: Date = new Date()): TimeBand {
  const hour = date.getHours();
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  return 'evening'; // 5pm-5am
}

interface GreetingVariant {
  headline: (name: string) => string;
  subtitle: string;
}

const GREETINGS: Record<TimeBand, readonly GreetingVariant[]> = {
  morning: [
    {
      headline: (n) => `Good morning${n ? `, ${n}` : ''} 👋🏽 Here's who to reconnect with today`,
      subtitle: 'One meaningful check-in a day keeps your connections alive.',
    },
    {
      headline: (n) => `Rise and shine${n ? `, ${n}` : ''} ☀️ Here's today's connection`,
      subtitle: 'A quick hello now goes a long way by tonight.',
    },
    {
      headline: (n) => `Morning${n ? `, ${n}` : ''} 👋🏽 Ready to make someone's day?`,
      subtitle: 'Start the day by staying close to the people who matter.',
    },
  ],
  afternoon: [
    {
      headline: (n) => `Hey${n ? ` ${n}` : ''} 👋🏽 Here's who to catch up with this afternoon`,
      subtitle: 'One meaningful check-in a day keeps your connections alive.',
    },
    {
      headline: (n) => `Good afternoon${n ? `, ${n}` : ''} — here's today's connection`,
      subtitle: "There's still time for one good conversation today.",
    },
    {
      headline: (n) => `Hi${n ? ` ${n}` : ''} 👋🏽 Halfway through the day — who deserves a call?`,
      subtitle: 'A short check-in now keeps the connection alive.',
    },
  ],
  evening: [
    {
      headline: (n) => `Good evening${n ? `, ${n}` : ''} 🌙 Here's who to reconnect with tonight`,
      subtitle: 'One meaningful check-in a day keeps your connections alive.',
    },
    {
      headline: (n) => `Evening${n ? `, ${n}` : ''} 👋🏽 One more call before the day ends?`,
      subtitle: "It's not too late to make someone's day.",
    },
    {
      headline: (n) => `Hey${n ? ` ${n}` : ''} 🌙 Here's tonight's connection`,
      subtitle: 'A quick hello tonight keeps the streak alive.',
    },
  ],
};

/** Dashboard header - changes across the 3 time bands, and rotates within a band day to day. */
export function getDashboardGreeting(firstName: string, date: Date = new Date()) {
  const band = getTimeBand(date);
  const variant = pickForDay(GREETINGS[band], `greeting:${band}`, date);
  return { headline: variant.headline(firstName), subtitle: variant.subtitle };
}

const ENCOURAGEMENT_BANNERS = [
  "💙 Every call strengthens a bond. You've got this!",
  '💙 A short call today can mean a lot to someone.',
  "💙 Staying in touch is a small habit with a big impact.",
  "💙 One conversation at a time — you're building something real.",
] as const;

/** Dashboard's bottom encouragement card - once a day. */
export function getEncouragementBanner(date: Date = new Date()): string {
  return pickForDay(ENCOURAGEMENT_BANNERS, 'encouragement-banner', date);
}

const STATS_ENCOURAGEMENTS = [
  (n: number) => `You've made ${n} ${n === 1 ? 'call' : 'calls'} this week. Every conversation strengthens your relationships. Keep up the wonderful work! 💙`,
  (n: number) => `${n} ${n === 1 ? 'call' : 'calls'} this week — and every one of them mattered. Keep showing up for the people you love. 🌟`,
  (n: number) => `That's ${n} ${n === 1 ? 'call' : 'calls'} this week. Small check-ins add up to strong relationships. 💙`,
  (n: number) => `${n} ${n === 1 ? 'conversation' : 'conversations'} this week. You're proof that staying close doesn't take much - just consistency. 🌟`,
] as const;

/** Stats page "You're Amazing!" card body - once a day. */
export function getStatsEncouragement(callsThisWeek: number, date: Date = new Date()): string {
  return pickForDay(STATS_ENCOURAGEMENTS, 'stats-encouragement', date)(callsThisWeek);
}

const FUN_FACTS = [
  "Regular phone conversations have been shown to reduce stress and strengthen emotional bonds. You're not just making calls—you're building a healthier, happier life! 🌟",
  "A short voice call carries more warmth than a text - tone of voice conveys emotion that words on a screen can't. 🌟",
  'Consistent, small check-ins build stronger relationships than occasional big gestures. 💙',
  "Hearing a loved one's voice can lower stress hormones within minutes. Every call you make helps. 🌟",
] as const;

/** Stats page "Did you know?" card - once a day. */
export function getFunFact(date: Date = new Date()): string {
  return pickForDay(FUN_FACTS, 'fun-fact', date);
}
