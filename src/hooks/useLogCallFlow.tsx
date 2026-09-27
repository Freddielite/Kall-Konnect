import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { DateTimePicker } from '@/components/DateTimePicker';
import { Contact, CallNote } from '@/types/contact';
import { useToast } from '@/hooks/use-toast';

interface UseLogCallFlowArgs {
  contacts: Contact[];
  addCallNote: (contactId: string, note: Omit<CallNote, 'id'>) => void | Promise<void>;
}

/**
 * "Log a call" (⋮ menu) - for a call made outside the app (native dialer,
 * WhatsApp directly, etc.) that never triggers the in-app, Page-Visibility-
 * driven "how did the call go?" flow. Two steps: a date/time picker (the
 * call may have happened earlier than now), then a note + duration dialog,
 * both stamped with the chosen moment rather than "now".
 *
 * Call `openLogCall(contactId)` to start the flow; render `dialogs` once,
 * anywhere in the page.
 */
export function useLogCallFlow({ contacts, addCallNote }: UseLogCallFlowArgs) {
  const { toast } = useToast();

  const [activeContactId, setActiveContactId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerValue, setPickerValue] = useState<Date>(new Date());
  const [noteOpen, setNoteOpen] = useState(false);
  const [manualCallDate, setManualCallDate] = useState<Date | null>(null);
  const [durationInput, setDurationInput] = useState('');
  const [note, setNote] = useState('');

  const openLogCall = (contactId: string) => {
    setActiveContactId(contactId);
    setPickerValue(new Date());
    setPickerOpen(true);
  };

  const closePicker = () => {
    setPickerOpen(false);
    setActiveContactId(null);
  };

  const confirmTime = () => {
    setManualCallDate(pickerValue);
    setDurationInput('');
    setNote('');
    setPickerOpen(false);
    setNoteOpen(true);
  };

  const closeNote = () => {
    setNoteOpen(false);
    setManualCallDate(null);
    setDurationInput('');
    setNote('');
    setActiveContactId(null);
  };

  const saveNote = () => {
    const contact = contacts.find((c) => c.id === activeContactId);
    if (contact && note.trim() && manualCallDate && activeContactId) {
      const duration = durationInput.trim() ? Math.max(0, parseInt(durationInput, 10)) : undefined;
      addCallNote(activeContactId, { date: manualCallDate, content: note, duration });
      toast({
        title: 'Note saved! 📝',
        description: `Your conversation with ${contact.name} has been recorded.`,
      });
    }
    closeNote();
  };

  const dialogs = (
    <>
      <Dialog open={pickerOpen} onOpenChange={(open) => { if (!open) closePicker(); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-xl">When did you call?</DialogTitle>
            <DialogDescription>
              Log a call you made outside the app - phone, WhatsApp, etc.
            </DialogDescription>
          </DialogHeader>
          <DateTimePicker value={pickerValue} onChange={setPickerValue} />
          <div className="flex gap-3 pt-2">
            <Button variant="outline" onClick={closePicker} className="flex-1 rounded-full">
              Cancel
            </Button>
            <Button onClick={confirmTime} className="flex-1 rounded-full">
              Continue
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={noteOpen} onOpenChange={(open) => { if (!open) closeNote(); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-xl">How did the call go?</DialogTitle>
            <DialogDescription>
              Add a quick note to remember this conversation
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            {manualCallDate && (
              <p className="text-xs text-muted-foreground -mt-2">
                Logging a call from {manualCallDate.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
              </p>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="manual-call-duration" className="text-xs text-muted-foreground">
                How long was the call, in minutes? (optional)
              </Label>
              <Input
                id="manual-call-duration"
                type="number"
                inputMode="numeric"
                min={0}
                placeholder="e.g. 12"
                value={durationInput}
                onChange={(e) => setDurationInput(e.target.value)}
              />
            </div>
            <Textarea
              placeholder="e.g., Caught up on work projects, planning to meet for coffee next week..."
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="min-h-[100px] resize-none"
            />
            <div className="flex gap-3">
              <Button variant="outline" onClick={closeNote} className="flex-1 rounded-full">
                Skip
              </Button>
              <Button onClick={saveNote} className="flex-1 rounded-full" disabled={!note.trim()}>
                Save Note
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );

  return { openLogCall, isOpen: pickerOpen || noteOpen, dialogs };
}
