import { Contact, TemplateTone } from '@/types/contact';

const MIN_SAMPLES = 2;
// The learned tone needs a clear majority among explicit picks, not
// just a narrow plurality, before it overrides the static default.
const MAJORITY_RATIO = 0.6;

/**
 * Learns which tone the user actually tends to pick (via the Templates
 * dialog) for a given relationship type, from their own past explicit
 * choices. contact.templateTone is only ever set when the user has
 * picked one themselves - see TemplateDialog - never as a silent
 * default, so this only counts real signal. Used to pre-select new
 * contacts' tone instead of the one-size-fits-all
 * defaultToneForRelationship table in data/templates.ts.
 */
export function learnedToneForRelationship(
  contacts: Contact[],
  relationship: Contact['relationship']
): TemplateTone | null {
  const counts = new Map<TemplateTone, number>();
  let total = 0;

  for (const contact of contacts) {
    if (contact.relationship !== relationship || !contact.templateTone) continue;
    counts.set(contact.templateTone, (counts.get(contact.templateTone) || 0) + 1);
    total += 1;
  }

  if (total < MIN_SAMPLES) return null;

  let best: TemplateTone | null = null;
  let bestCount = 0;
  for (const [tone, count] of counts) {
    if (count > bestCount) {
      best = tone;
      bestCount = count;
    }
  }

  if (!best || bestCount / total < MAJORITY_RATIO) return null;
  return best;
}
