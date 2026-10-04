import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Mail, CheckCircle2, XCircle } from 'lucide-react';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/utils';
import { useAuth } from '@/lib/auth-context';

type Status = 'verifying' | 'success' | 'error';

export default function VerifyEmail() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const { session, refreshProfile } = useAuth();
  const [status, setStatus] = useState<Status>('verifying');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!token) {
      setStatus('error');
      setError('This verification link is missing its token.');
      return;
    }
    (async () => {
      try {
        await api.post('/auth/verify-email', { token }, { auth: false });
        setStatus('success');
        // If they're signed in on this device (the usual case - they just
        // tapped the link from the device they signed up on), pick up
        // emailVerified: true right away so the banner disappears without
        // a reload. If they're not signed in here, this just quietly fails.
        await refreshProfile();
      } catch (err: unknown) {
        setStatus('error');
        setError(errorMessage(err, 'This verification link is invalid or has expired.'));
      }
    })();
    // Only ever run once per token - refreshProfile/token are stable for
    // the life of this page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  return (
    <div className="min-h-screen pt-safe flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md p-8 shadow-elegant text-center space-y-4 animate-in fade-in-0 slide-in-from-bottom-6 duration-700">
        {status === 'verifying' && (
          <>
            <Mail className="h-12 w-12 mx-auto text-primary animate-pulse" />
            <h1 className="text-2xl font-bold text-foreground">Verifying your email...</h1>
          </>
        )}

        {status === 'success' && (
          <>
            <CheckCircle2 className="h-12 w-12 mx-auto text-green-500" />
            <h1 className="text-2xl font-bold text-foreground">Email verified</h1>
            <p className="text-sm text-muted-foreground">Your email is confirmed.</p>
            <Button className="w-full" onClick={() => navigate(session ? '/' : '/auth')}>
              {session ? 'Continue to Kall Konnect' : 'Go to sign in'}
            </Button>
          </>
        )}

        {status === 'error' && (
          <>
            <XCircle className="h-12 w-12 mx-auto text-destructive" />
            <h1 className="text-2xl font-bold text-foreground">Couldn't verify</h1>
            <p className="text-sm text-muted-foreground">{error}</p>
            <Button className="w-full" onClick={() => navigate(session ? '/' : '/auth')}>
              {session ? 'Back to Kall Konnect' : 'Back to sign in'}
            </Button>
          </>
        )}
      </Card>
    </div>
  );
}
