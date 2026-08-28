import { Contact, SpecialDate } from '@/types/contact';

export type OccasionType = 'birthday' | 'anniversary' | 'special';

export interface UpcomingOccasion {
  contact: Contact;
  type: OccasionType;
  label: string;
  date: Date;
  daysUntil: number;
  message: string;
}

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/** Next yearly recurrence of a month/day, relative to today. */
function nextOccurrence(date: Date, from = new Date()): { date: Date; daysUntil: number } {
  const today = startOfDay(from);
  let next = new Date(today.getFullYear(), date.getMonth(), date.getDate());
  if (next.getTime() < today.getTime()) {
    next = new Date(today.getFullYear() + 1, date.getMonth(), date.getDate());
  }
  const daysUntil = Math.round((next.getTime() - today.getTime()) / 86400000);
  return { date: next, daysUntil };
}

export function celebratoryMessage(
  type: OccasionType,
  name: string,
  daysUntil: number,
  label?: string
): string {
  const when = daysUntil === 0 ? 'today' : daysUntil === 1 ? 'tomorrow' : `in ${daysUntil} days`;

  if (type === 'birthday') {
    return daysUntil === 0
      ? `Happy birthday, ${name}! 🎂 Give them a call and make their day.`
      : `${name}'s birthday is ${when} 🎂 — call ahead and wish them well!`;
  }
  if (type === 'anniversary') {
    return daysUntil === 0
      ? `Happy anniversary, ${name}! 🥂 Call to celebrate with them.`
      : `${name}'s anniversary is ${when} 🥂 — a quick call would mean a lot.`;
  }
  return daysUntil === 0
    ? `It's ${name}'s ${label} today 🎉 — call and celebrate the moment!`
    : `${name}'s ${label} is ${when} 🎉 — a call would be a lovely surprise.`;
}

/** Occasions (birthday, anniversary, custom special dates) falling within the next `withinDays` days. */
export function getUpcomingOccasions(contacts: Contact[], withinDays = 3): UpcomingOccasion[] {
  const occasions: UpcomingOccasion[] = [];

  const push = (contact: Contact, type: OccasionType, label: string, raw: Date) => {
    const { date, daysUntil } = nextOccurrence(new Date(raw));
    if (daysUntil >= 0 && daysUntil <= withinDays) {
      occasions.push({
        contact,
        type,
        label,
        date,
        daysUntil,
        message: celebratoryMessage(type, contact.name, daysUntil, label),
      });
    }
  };

  contacts.forEach((contact) => {
    if (contact.birthday) push(contact, 'birthday', 'Birthday', contact.birthday);
    if (contact.anniversary) push(contact, 'anniversary', 'Anniversary', contact.anniversary);
    (contact.specialDates || []).forEach((sd: SpecialDate) => {
      if (sd.date && sd.label) push(contact, 'special', sd.label, new Date(sd.date));
    });
  });

  return occasions.sort((a, b) => a.daysUntil - b.daysUntil);
}
