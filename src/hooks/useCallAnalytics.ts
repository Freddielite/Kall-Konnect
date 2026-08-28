import { useMemo } from 'react';
import { Contact } from '@/types/contact';
import { buildFollowUpVocabulary, matchFollowUpSignal } from '@/lib/noteSignals';
import { bestTimeToCall } from '@/lib/callTiming';
import { suggestedFrequency } from '@/lib/frequencyFit';

interface ContactAnalytics {
  contactId: string;
  contact: Contact;
  averageInterval: number; // in days
  daysSinceLastCall: number;
  totalCalls: number;
  isOverdue: boolean;
  urgencyScore: number; // higher = more urgent to call
  expectedNextCall: Date | null;
  // Below MIN_CALLS_FOR_CONFIDENCE, averageInterval is mostly a guess
  // (getDefaultInterval), so "overdue" doesn't mean as much yet.
  isLowConfidence: boolean;
  // The most recent note matched a learned "this needs following up on
  // soon" signal word (see lib/noteSignals) - a cut-short call, bad
  // timing, etc surfaced automatically instead of relying on the
  // contact's normal call-frequency schedule.
  followUpFlagged: boolean;
  // Day/time window this contact's calls actually tend to land in
  // (see lib/callTiming) - null until there's enough history to say.
  bestTime: string | null;
  // Set only when the real rhythm (averageInterval) has clearly
  // drifted from contact.callFrequency and there's enough history to
  // trust averageInterval in the first place (see lib/frequencyFit).
  suggestedFrequency: Contact['callFrequency'] | null;
}

// Same "needs to happen at least a few times to be a real pattern, not
// a fluke" bar FocusDial's TimerPanel uses for its own nudges
// (MIN_NUDGE_SESSIONS) - below this many logged calls, we don't yet
// know this contact's real rhythm, just a guess from callFrequency.
const MIN_CALLS_FOR_CONFIDENCE = 3;

// Flat urgency bump for a contact whose most recent note tripped the
// learned follow-up vocabulary - enough to visibly move them up the
// list without letting it single-handedly dominate favorite/relationship
// weighting.
const FOLLOW_UP_SIGNAL_BOOST = 12;

export const useCallAnalytics = (contacts: Contact[]) => {
  // Learned once per contacts change, shared across every contact below -
  // building it is a full scan of everyone's note history, not something
  // to redo per-contact.
  const followUpVocabulary = useMemo(() => buildFollowUpVocabulary(contacts), [contacts]);

  const analytics = useMemo(() => {
    const now = new Date();
    
    return contacts.map((contact): ContactAnalytics => {
      const notes = contact.notes || [];
      const isLowConfidence = notes.length < MIN_CALLS_FOR_CONFIDENCE;
      const mostRecentNote = notes.length
        ? [...notes].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0]
        : null;
      const followUpFlagged = mostRecentNote
        ? matchFollowUpSignal(mostRecentNote.content, followUpVocabulary)
        : false;
      const sortedNotes = [...notes].sort((a, b) => 
        new Date(b.date).getTime() - new Date(a.date).getTime()
      );

      // Calculate average interval between calls
      let totalInterval = 0;
      let intervalCount = 0;

      for (let i = 0; i < sortedNotes.length - 1; i++) {
        const current = new Date(sortedNotes[i].date);
        const next = new Date(sortedNotes[i + 1].date);
        const diff = Math.abs(current.getTime() - next.getTime());
        const days = Math.ceil(diff / (1000 * 60 * 60 * 24));
        totalInterval += days;
        intervalCount++;
      }

      const averageInterval = intervalCount > 0 
        ? Math.round(totalInterval / intervalCount)
        : getDefaultInterval(contact.callFrequency);

      // Days since last call
      const lastCallDate = contact.lastCalled ? new Date(contact.lastCalled) : null;
      const daysSinceLastCall = lastCallDate
        ? Math.floor((now.getTime() - lastCallDate.getTime()) / (1000 * 60 * 60 * 24))
        : 999;

      // Expected next call date
      const expectedNextCall = lastCallDate
        ? new Date(lastCallDate.getTime() + averageInterval * 24 * 60 * 60 * 1000)
        : null;

      // Is overdue based on average interval
      const isOverdue = daysSinceLastCall > averageInterval;

      // Calculate urgency score (0-100)
      // Factors: days overdue, favorite status, relationship type
      let urgencyScore = 0;
      
      if (daysSinceLastCall > averageInterval) {
        const daysOverdue = daysSinceLastCall - averageInterval;
        // Full weight once we actually know this contact's rhythm; halved
        // while averageInterval is still just callFrequency's generic
        // default, so one early call doesn't get treated as "very overdue"
        // against a guessed schedule.
        const overdueWeight = isLowConfidence ? 0.5 : 1;
        urgencyScore += Math.min(daysOverdue * 2, 50) * overdueWeight; // Max 50 points for overdue
      }

      if (followUpFlagged) {
        urgencyScore += FOLLOW_UP_SIGNAL_BOOST;
      }

      if (contact.isFavorite) {
        urgencyScore += 20; // Favorites get priority boost
      }

      // Family gets higher priority
      if (contact.relationship === 'family') {
        urgencyScore += 15;
      } else if (contact.relationship === 'friend') {
        urgencyScore += 10;
      } else {
        urgencyScore += 5;
      }

      // Adjust for priority field
      urgencyScore += contact.priority * 5;

      // Cap at 100
      urgencyScore = Math.min(urgencyScore, 100);

      return {
        contactId: contact.id,
        contact,
        averageInterval,
        daysSinceLastCall,
        totalCalls: notes.length,
        isOverdue,
        urgencyScore,
        expectedNextCall,
        isLowConfidence,
        followUpFlagged,
        bestTime: bestTimeToCall(contact),
        suggestedFrequency: isLowConfidence ? null : suggestedFrequency(contact, averageInterval),
      };
    });
  }, [contacts, followUpVocabulary]);

  // Sort by urgency score (highest first)
  const prioritizedContacts = useMemo(() => {
    return [...analytics]
      .filter(a => {
        // Filter out snoozed contacts
        if (a.contact.snoozedUntil) {
          return new Date(a.contact.snoozedUntil) < new Date();
        }
        return true;
      })
      .sort((a, b) => b.urgencyScore - a.urgencyScore);
  }, [analytics]);

  // Get top reconnection suggestions (most urgent)
  const reconnectionSuggestions = useMemo(() => {
    return prioritizedContacts.slice(0, 7);
  }, [prioritizedContacts]);

  return {
    analytics,
    prioritizedContacts,
    reconnectionSuggestions,
  };
};

// Helper function to get default interval based on frequency
function getDefaultInterval(frequency: string): number {
  switch (frequency) {
    case 'weekly':
      return 7;
    case 'biweekly':
      return 14;
    case 'monthly':
      return 30;
    default:
      return 14;
  }
}
