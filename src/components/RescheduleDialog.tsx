import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Contact } from '@/types/contact';
import { useToast } from '@/hooks/use-toast';
import { Clock } from 'lucide-react';

interface RescheduleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contact: Contact | null;
  onReschedule: (contactId: string, date: Date) => void;
}

export function RescheduleDialog({ open, onOpenChange, contact, onReschedule }: RescheduleDialogProps) {
  const { toast } = useToast();
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(undefined);

  const handleQuickSnooze = (days: number) => {
    if (!contact) return;
    
    const snoozeDate = new Date();
    snoozeDate.setDate(snoozeDate.getDate() + days);
    
    onReschedule(contact.id, snoozeDate);
    
    toast({
      title: "Call rescheduled 📅",
      description: `${contact.name} will appear in your call plan in ${days} day${days > 1 ? 's' : ''}.`,
    });
    
    onOpenChange(false);
  };

  const handleCustomReschedule = () => {
    if (!contact || !selectedDate) {
      toast({
        title: "Please select a date",
        variant: "destructive"
      });
      return;
    }
    
    onReschedule(contact.id, selectedDate);
    
    const daysUntil = Math.ceil((selectedDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    
    toast({
      title: "Call rescheduled 📅",
      description: `${contact.name} will appear in your call plan in ${daysUntil} day${daysUntil > 1 ? 's' : ''}.`,
    });
    
    setSelectedDate(undefined);
    onOpenChange(false);
  };

  if (!contact) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Reschedule Call with {contact.name}</DialogTitle>
          <DialogDescription>
            Choose when you'd like to be reminded to call again
          </DialogDescription>
        </DialogHeader>
        
        <div className="space-y-6 pt-4">
          {/* Quick Snooze Options */}
          <div className="space-y-3">
            <p className="text-sm font-medium text-foreground">Quick reschedule:</p>
            <div className="grid grid-cols-2 gap-2">
              <Button
                variant="outline"
                className="gap-2"
                onClick={() => handleQuickSnooze(1)}
              >
                <Clock className="h-4 w-4" />
                Tomorrow
              </Button>
              <Button
                variant="outline"
                className="gap-2"
                onClick={() => handleQuickSnooze(3)}
              >
                <Clock className="h-4 w-4" />
                3 Days
              </Button>
              <Button
                variant="outline"
                className="gap-2"
                onClick={() => handleQuickSnooze(7)}
              >
                <Clock className="h-4 w-4" />
                1 Week
              </Button>
              <Button
                variant="outline"
                className="gap-2"
                onClick={() => handleQuickSnooze(14)}
              >
                <Clock className="h-4 w-4" />
                2 Weeks
              </Button>
            </div>
          </div>

          {/* Custom Date Picker */}
          <div className="space-y-3">
            <p className="text-sm font-medium text-foreground">Or choose a specific date:</p>
            <div className="flex justify-center">
              <Calendar
                mode="single"
                selected={selectedDate}
                onSelect={setSelectedDate}
                disabled={(date) => date < new Date()}
                className="rounded-md border"
              />
            </div>
          </div>

          <div className="flex gap-2 justify-end pt-4">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button 
              onClick={handleCustomReschedule}
              disabled={!selectedDate}
            >
              Confirm Date
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
