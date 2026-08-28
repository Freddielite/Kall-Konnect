import { Contact } from '@/types/contact';

// A word needs to show up in at least this many "short-gap" notes before
// it's trusted as a real signal rather than a one-off - same "needs at
// least a few occurrences to be a real pattern" bar used for the
// confidence gating in useCallAnalytics.
const MIN_WORD_OCCURRENCES = 3;

// A word must appear at least this many times more often in short-gap
// notes than long-gap notes to count as a signal word, rather than just
// being a generic word ("call", "good") that shows up everywhere.
const SIGNAL_RATIO_THRESHOLD = 2;

// A gap counts as "short" or "long" only when it's meaningfully off this
// contact's own average - not just noise around a normal interval.
const SHORT_GAP_FACTOR = 0.6;
const LONG_GAP_FACTOR = 1.4;

const STOPWORDS = new Set([
  'the', 'and', 'for', 'that', 'with', 'was', 'were', 'this', 'they',
  'she', 'him', 'her', 'his', 'have', 'has', 'had', 'about', 'just',
  'really', 'very', 'some', 'from', 'what', 'when', 'then', 'than',
  'into', 'went', 'said', 'told', 'like', 'good', 'nice', 'call',
  'called', 'talk', 'talked', 'chat', 'chatted', 'phone', 'today',
  'yesterday', 'week', 'weeks', 'month', 'months',
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9'\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

export interface FollowUpVocabulary {
  signalWords: Set<string>;
}

export const EMPTY_VOCABULARY: FollowUpVocabulary = { signalWords: new Set() };

/**
 * Learns which words tend to appear in notes that were, in hindsight,
 * followed by an unusually short gap before the next call - i.e. notes
 * that were quietly signaling "this one needs following up on soon"
 * (a call cut short, bad timing, "let's finish this later"). Built
 * entirely from this user's own note history rather than a fixed
 * keyword list, so it reflects how they actually write, and it costs
 * nothing until there's enough history to say anything - see
 * matchFollowUpSignal, which returns false against an empty vocabulary.
 */
export function buildFollowUpVocabulary(contacts: Contact[]): FollowUpVocabulary {
  const shortGapCounts = new Map<string, number>();
  const longGapCounts = new Map<string, number>();

  for (const contact of contacts) {
    const sorted = [...contact.notes].sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
    );
    if (sorted.length < 3) continue; // need at least 2 gaps to have an "average" worth deviating from

    const gaps: number[] = [];
    for (let i = 0; i < sorted.length - 1; i++) {
      const days = Math.abs(
        (new Date(sorted[i + 1].date).getTime() - new Date(sorted[i].date).getTime()) /
          (1000 * 60 * 60 * 24)
      );
      gaps.push(days);
    }
    const avgGap = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    if (avgGap === 0) continue;

    for (let i = 0; i < gaps.length; i++) {
      const words = new Set(tokenize(sorted[i].content));
      const isShort = gaps[i] < avgGap * SHORT_GAP_FACTOR;
      const isLong = gaps[i] > avgGap * LONG_GAP_FACTOR;
      for (const word of words) {
        if (isShort) shortGapCounts.set(word, (shortGapCounts.get(word) || 0) + 1);
        if (isLong) longGapCounts.set(word, (longGapCounts.get(word) || 0) + 1);
      }
    }
  }

  const signalWords = new Set<string>();
  for (const [word, shortCount] of shortGapCounts) {
    if (shortCount < MIN_WORD_OCCURRENCES) continue;
    const longCount = longGapCounts.get(word) || 0;
    if (shortCount >= Math.max(longCount, 1) * SIGNAL_RATIO_THRESHOLD) {
      signalWords.add(word);
    }
  }

  return { signalWords };
}

/** True if any word in `text` is a learned follow-up signal word. */
export function matchFollowUpSignal(text: string, vocabulary: FollowUpVocabulary): boolean {
  if (!text || vocabulary.signalWords.size === 0) return false;
  return tokenize(text).some((w) => vocabulary.signalWords.has(w));
}
