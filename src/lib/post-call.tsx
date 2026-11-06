import { createContext, useCallback, useContext, useEffect, useMemo, useState, ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { CONTACTS_QUERY_KEY } from '@/hooks/useContacts';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/utils';
import { isQuickReturn } from '@/lib/callOutcome';
import { buildFollowUpVocabulary, matchFollowUpSignal } from '@/lib/noteSignals';
import type { Contact } from '@/types/contact';

/**
 * "How was your call?" — app-wide.
 *
 * Calls placed from any screen (Dashboard, Contacts, a contact's page, the
 * "Call now" button on a reminder) report here via startCall(). When the
 * user comes back after being away long enough for a real conversation,
 * this asks how it went; one tap logs it, and the note is optional.
 *
 * The pending call is kept in localStorage, not just React state: Android
 * often kills a backgrounded web app during a long call, and the prompt
 * used to vanish with it. On the next launch it's picked up from storage.
 */

const STORAGE_KEY = 'kk:pending-call';
/** Older than this and the prompt would be more confusing than useful. */
const MAX_AGE_MS = 3 * 3600_000;
/** Leaving the app this soon after tapping Call is the call starting. */
const START_WINDOW_MS = 60_000;

interface PendingCall {
  contactId: string;
  contactName: string;
  platform: string;
  tappedAt: number;
  hiddenAt: number | null;
}

interface Prompt {
  contactId: string;
  contactName: string;
  /** When the call began (left the app), or null for a manual log. */
  startedAt: number | null;
  durationMinutes: number | null;
}

interface PostCallContextValue {
  /** Call right after handing off to the dialer / WhatsApp. */
  startCall: (contact: Pick<Contact, 'id' | 'name'>, platform: string) => void;
  /** Open the prompt directly, for a call that wasn't placed from the app. */
  openCallLog: (contact: Pick<Contact, 'id' | 'name'>) => void;
}

const PostCallContext = createContext<PostCallContextValue | null>(null);

function readPending(): PendingCall | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as PendingCall) : null;
  } catch {
    return null;
  }
}

function writePending(p: PendingCall | null) {
  try {
    if (p) localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Private mode / storage full: the in-session flow still works.
  }
}

export function PostCallProvider({ children }: { children: ReactNode }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  /** Decides what a return to the app means for the pending call. */
  const evaluate = useCallback((source: 'visible' | 'launch') => {
    const pending = readPending();
    if (!pending) return;
    const now = Date.now();
    if (pending.hiddenAt == null) {
      // Never actually left: the OS "Call?" sheet was cancelled. On a fresh
      // launch with no hiddenAt there's nothing to go on either.
      if (source === 'launch' || now - pending.tappedAt > 2000) writePending(null);
      return;
    }
    writePending(null);
    const elapsed = now - pending.hiddenAt;
    if (elapsed > MAX_AGE_MS) return;
    if (isQuickReturn(elapsed)) {
      toast({ title: 'That was quick', description: "Looks like the call didn't go through. Nothing logged." });
      return;
    }
    setNote('');
    setPrompt({
      contactId: pending.contactId,
      contactName: pending.contactName,
      startedAt: pending.hiddenAt,
      durationMinutes: Math.max(1, Math.round(elapsed / 60_000)),
    });
  }, [toast]);

  useEffect(() => {
    evaluate('launch');
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        // Only counts as the call starting if it follows the tap closely;
        // otherwise a cancelled call would be "started" by the next, unrelated
        // switch away from the app, and prompt for a call that never was.
        const pending = readPending();
        if (pending && pending.hiddenAt == null) {
          writePending(Date.now() - pending.tappedAt < START_WINDOW_MS ? { ...pending, hiddenAt: Date.now() } : null);
        }
      } else {
        evaluate('visible');
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [evaluate]);

  const startCall = useCallback<PostCallContextValue['startCall']>((contact, platform) => {
    writePending({ contactId: contact.id, contactName: contact.name, platform, tappedAt: Date.now(), hiddenAt: null });
  }, []);

  const openCallLog = useCallback<PostCallContextValue['openCallLog']>((contact) => {
    setNote('');
    setPrompt({ contactId: contact.id, contactName: contact.name, startedAt: null, durationMinutes: null });
  }, []);

  const close = () => {
    setPrompt(null);
    setNote('');
  };

  const logCall = async () => {
    if (!prompt) return;
    setSaving(true);
    try {
      await api.post('/call-notes', {
        contact_id: prompt.contactId,
        content: note.trim(),
        duration: prompt.durationMinutes ?? undefined,
        called_at: new Date(prompt.startedAt ?? Date.now()).toISOString(),
      });
      await queryClient.invalidateQueries({ queryKey: CONTACTS_QUERY_KEY });
      toast({ title: 'Call logged 📞', description: `Nice one. ${prompt.contactName}'s reminders will take this into account.` });
      close();
    } catch (err) {
      toast({ title: "Couldn't log that call", description: errorMessage(err), variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  // Same "worth following up on?" hint the Dashboard dialog had, from the
  // contacts already in the query cache.
  const followUpHint = useMemo(() => {
    if (!prompt || !note.trim()) return false;
    const contacts = queryClient.getQueryData<Contact[]>(CONTACTS_QUERY_KEY) ?? [];
    return matchFollowUpSignal(note, buildFollowUpVocabulary(contacts));
  }, [note, prompt, queryClient]);

  const value = useMemo(() => ({ startCall, openCallLog }), [startCall, openCallLog]);

  return (
    <PostCallContext.Provider value={value}>
      {children}
      <Dialog open={prompt !== null} onOpenChange={(open) => { if (!open) close(); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-xl">
              {prompt?.startedAt ? `How was your call with ${prompt.contactName}?` : `Log a call with ${prompt?.contactName}`}
            </DialogTitle>
            <DialogDescription>
              {prompt?.durationMinutes
                ? `About ${prompt.durationMinutes} min. Logging it keeps reminders and your streak accurate.`
                : 'Logging it keeps reminders and your streak accurate.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 pt-1">
            <div className="space-y-1.5">
              <Textarea
                placeholder="Anything to remember for next time? (optional)"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="min-h-[90px] resize-none"
                aria-label="Note about the call (optional)"
              />
              {followUpHint && (
                <p className="text-xs text-muted-foreground">
                  Noted. This sounds like one to check back on sooner than usual.
                </p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Button variant="outline" className="rounded-full" onClick={close} disabled={saving}>
                {prompt?.startedAt ? "We didn't talk" : 'Cancel'}
              </Button>
              <Button className="rounded-full" onClick={logCall} disabled={saving}>
                {saving ? 'Saving…' : 'Log call'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </PostCallContext.Provider>
  );
}

export function usePostCall(): PostCallContextValue {
  const ctx = useContext(PostCallContext);
  if (!ctx) throw new Error('usePostCall must be used inside PostCallProvider');
  return ctx;
}
