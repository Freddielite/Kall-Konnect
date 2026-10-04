import { useState } from 'react';
import { Mail, X } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/utils';

const DISMISS_KEY = 'verify-email-banner-dismissed';

/**
 * Shown on the Dashboard for a signed-in user whose email isn't verified
 * yet (login is never gated on this - see migration 003_auth_hardening.sql).
 * Dismissing it only hides it for the current browser session
 * (sessionStorage), so it comes back next time they open the app until
 * they actually verify.
 */
export function EmailVerificationBanner() {
  const [dismissed, setDismissed] = useState(() => sessionStorage.getItem(DISMISS_KEY) === '1');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  if (dismissed) return null;

  const handleResend = async () => {
    setSending(true);
    try {
      await api.post('/auth/resend-verification');
      setSent(true);
      toast.success('Verification email sent — check your inbox.');
    } catch (err: unknown) {
      toast.error(errorMessage(err, 'Could not resend the verification email.'));
    } finally {
      setSending(false);
    }
  };

  const handleDismiss = () => {
    sessionStorage.setItem(DISMISS_KEY, '1');
    setDismissed(true);
  };

  return (
    <Card className="p-4 flex items-start gap-3 bg-accent/10 border-accent/30">
      <Mail className="h-5 w-5 text-accent shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground">Verify your email</p>
        <p className="text-sm text-muted-foreground mt-0.5">
          {sent
            ? "Check your inbox for the link — it expires in 24 hours."
            : "We sent a link when you signed up. Didn't get it?"}
        </p>
        {!sent && (
          <Button
            size="sm"
            variant="outline"
            className="mt-2 rounded-full"
            onClick={handleResend}
            disabled={sending}
          >
            {sending ? 'Sending...' : 'Resend email'}
          </Button>
        )}
      </div>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={handleDismiss}
        className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
      >
        <X className="h-4 w-4" />
      </button>
    </Card>
  );
}
