import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Mail, ArrowLeft } from 'lucide-react';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/utils';

export default function ForgotPassword() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      // Backend always responds the same way whether or not the address has
      // an account, so there's nothing more specific to branch on here.
      await api.post('/auth/forgot-password', { email }, { auth: false });
      setSent(true);
    } catch (err: unknown) {
      toast.error(errorMessage(err, 'Could not send the reset link.'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen pt-safe flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md p-8 shadow-elegant animate-in fade-in-0 slide-in-from-bottom-6 duration-700">
        <div className="text-center mb-8">
          <Mail className="h-12 w-12 mx-auto mb-4 text-primary" />
          <h1 className="text-2xl font-bold text-foreground mb-2">Reset your password</h1>
          <p className="text-sm text-muted-foreground">
            Enter your email and we'll send you a link to set a new password.
          </p>
        </div>

        {sent ? (
          <div className="space-y-6 text-center">
            <p className="text-sm text-foreground">
              If <span className="font-medium">{email}</span> has an account, a reset link is on its way. It expires in 1 hour.
            </p>
            <Button variant="outline" className="w-full" onClick={() => navigate('/auth')}>
              Back to sign in
            </Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="forgot-email">Email</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  id="forgot-email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="pl-10"
                  required
                  autoFocus
                />
              </div>
            </div>

            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? 'Sending...' : 'Send reset link'}
            </Button>

            <button
              type="button"
              onClick={() => navigate('/auth')}
              className="flex w-full items-center justify-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back to sign in
            </button>
          </form>
        )}
      </Card>
    </div>
  );
}
