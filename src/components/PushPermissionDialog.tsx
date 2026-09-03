import { Bell, Clock, Heart } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface PushPermissionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEnable: () => void;
  enabling?: boolean;
}

/**
 * A "primer" shown before the browser's own permission prompt.
 *
 * The native prompt cannot be restyled or replaced — browsers own it on
 * purpose, so a site can't dress up or pressure a permission grant. What we
 * control is the moment before it: this dialog makes the case in the app's
 * own voice, and only calls Notification.requestPermission() once the user
 * has already agreed here.
 *
 * That ordering matters more than it looks. A browser denial is permanent —
 * Chrome never prompts the same site twice — so a user who taps "Block" out
 * of reflex loses reminders for good, with no in-app way back. Asking first
 * means the one prompt we ever get is spent on someone who already said yes.
 */
export function PushPermissionDialog({
  open,
  onOpenChange,
  onEnable,
  enabling = false,
}: PushPermissionDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm rounded-2xl">
        <DialogHeader>
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10">
            <Bell className="h-7 w-7 text-primary" />
          </div>
          <DialogTitle className="text-center">Never miss a check-in</DialogTitle>
          <DialogDescription className="text-center">
            Reminders arrive on your lock screen, so staying in touch doesn't
            depend on remembering to open the app.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="flex gap-3">
            <Clock className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
            <div>
              <p className="text-sm font-medium">One reminder a day</p>
              <p className="text-xs text-muted-foreground">
                A single person to call, not a stream of alerts.
              </p>
            </div>
          </div>
          <div className="flex gap-3">
            <Heart className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
            <div>
              <p className="text-sm font-medium">Birthdays never slip</p>
              <p className="text-xs text-muted-foreground">
                Occasions come through even on quiet days.
              </p>
            </div>
          </div>
        </div>

        {/* Setting the expectation removes most reflex-blocks: people tap
            "Block" when a prompt appears unannounced and unexplained. */}
        <p className="rounded-xl bg-muted p-3 text-xs text-muted-foreground">
          Your phone will ask you to confirm next — choose <strong>Allow</strong>.
          If you block it, Android won't ask again and you'd have to re-enable
          it in browser settings.
        </p>

        <div className="flex flex-col gap-2">
          <Button className="w-full rounded-xl" onClick={onEnable} disabled={enabling}>
            {enabling ? 'Setting up…' : 'Turn on reminders'}
          </Button>
          <Button
            variant="ghost"
            className="w-full rounded-xl"
            onClick={() => onOpenChange(false)}
            disabled={enabling}
          >
            Not now
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
