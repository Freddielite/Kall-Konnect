import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card } from '@/components/ui/card';
import { Phone, CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';

type Status = 'verifying' | 'success' | 'error';

export default function VerifyEmail() {
  const { verifyEmail } = useAuth();
  const [status, setStatus] = useState<Status>('verifying');

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get('token');
    if (!token) {
      setStatus('error');
      return;
    }
    verifyEmail(token)
      .then(() => setStatus('success'))
      .catch(() => setStatus('error'));
    // Only ever run once per mount — verifyEmail consumes the token
    // server-side, so re-running on dependency changes would just error.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md p-8 shadow-elegant text-center space-y-4">
        <Phone className="h-12 w-12 mx-auto text-primary" />

        {status === 'verifying' && (
          <>
            <Loader2 className="h-8 w-8 mx-auto animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Verifying your email...</p>
          </>
        )}

        {status === 'success' && (
          <>
            <CheckCircle2 className="h-8 w-8 mx-auto text-primary" />
            <p className="text-foreground font-medium">Your email is verified.</p>
            <Link to="/" className="text-sm text-primary underline">Go to Kall Konnect</Link>
          </>
        )}

        {status === 'error' && (
          <>
            <XCircle className="h-8 w-8 mx-auto text-destructive" />
            <p className="text-foreground font-medium">This verification link is invalid or has expired.</p>
            <Link to="/settings" className="text-sm text-primary underline">Request a new one from Settings</Link>
          </>
        )}
      </Card>
    </div>
  );
}
