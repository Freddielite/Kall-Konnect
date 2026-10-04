import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Lock } from 'lucide-react';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/utils';

export default function ResetPassword() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirmPassword) {
      toast.error('Passwords do not match.');
      return;
    }
    setLoading(true);
    try {
      await api.post('/auth/reset-password', { token, password }, { auth: false });
      setDone(true);
      // Resetting the password revokes every existing session server-side,
      // so there's no "already signed in" state to preserve here — sign in
      // again with the new password.
      setTimeout(() => navigate('/auth'), 2000);
    } catch (err: unknown) {
      toast.error(errorMessage(err, 'This reset link is invalid or has expired.'));
    } finally {
      setLoading(false);
    }
  };

  if (!token) {
    return (
      <div className="min-h-screen pt-safe flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md p-8 shadow-elegant text-center space-y-4">
          <h1 className="text-2xl font-bold text-foreground">Invalid link</h1>
          <p className="text-sm text-muted-foreground">
            This password reset link is missing its token. Request a new one from the sign-in page.
          </p>
          <Button className="w-full" onClick={() => navigate('/forgot-password')}>
            Request a new link
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen pt-safe flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md p-8 shadow-elegant animate-in fade-in-0 slide-in-from-bottom-6 duration-700">
        <div className="text-center mb-8">
          <Lock className="h-12 w-12 mx-auto mb-4 text-primary" />
          <h1 className="text-2xl font-bold text-foreground mb-2">Set a new password</h1>
          <p className="text-sm text-muted-foreground">Choose something you haven't used before.</p>
        </div>

        {done ? (
          <p className="text-sm text-center text-foreground">
            Password updated. Taking you to sign in...
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="reset-password">New password</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  id="reset-password"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pl-10"
                  required
                  minLength={6}
                  autoFocus
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="reset-confirm-password">Confirm password</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  id="reset-confirm-password"
                  type="password"
                  placeholder="••••••••"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="pl-10"
                  required
                  minLength={6}
                />
              </div>
            </div>

            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? 'Updating...' : 'Update password'}
            </Button>
          </form>
        )}
      </Card>
    </div>
  );
}
