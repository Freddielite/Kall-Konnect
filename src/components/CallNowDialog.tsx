import { Phone, MessageCircle } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { usePostCall } from '@/lib/post-call';
import { normalizePhoneForWhatsApp } from '@/lib/phone';
import type { Contact } from '@/types/contact';

interface CallNowDialogProps {
  contact: Contact;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEditContact: () => void;
}

/**
 * Opened by "Call now" on a reminder. Browsers only let a page start a
 * call from a tap, so the reminder brings you here and this is the tap:
 * one button per way of reaching them. Placing the call starts the usual
 * "how was your call?" follow-up.
 */
export function CallNowDialog({ contact, open, onOpenChange, onEditContact }: CallNowDialogProps) {
  const { startCall } = usePostCall();
  const phone = contact.phone?.trim();
  const waNumber = normalizePhoneForWhatsApp(contact.whatsappPhone || contact.phone || '');

  const go = (url: string, platform: string) => {
    startCall(contact, platform);
    onOpenChange(false);
    // Same-tab navigation; see ContactCard's openLink for why not _blank.
    window.location.href = url;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-xl">Call {contact.name}</DialogTitle>
          <DialogDescription>
            {phone || waNumber ? 'How would you like to reach them?' : `There's no number saved for ${contact.name} yet.`}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2 pt-1">
          {phone && (
            <Button className="w-full rounded-xl h-12 gap-2" onClick={() => go(`tel:${phone}`, 'phone')}>
              <Phone className="h-5 w-5" aria-hidden="true" />
              Phone call
            </Button>
          )}
          {waNumber && (
            <Button
              variant="outline"
              className="w-full rounded-xl h-12 gap-2"
              onClick={() => go(`https://wa.me/${waNumber}`, 'whatsapp')}
            >
              <MessageCircle className="h-5 w-5" aria-hidden="true" />
              WhatsApp
            </Button>
          )}
          {!phone && !waNumber && (
            <Button className="w-full rounded-xl h-12" onClick={() => { onOpenChange(false); onEditContact(); }}>
              Add a number
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
