import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Phone, Mail, Lock, User } from 'lucide-react';
import { safeNext } from '@/lib/next-redirect';
import { errorMessage } from '@/lib/utils';
import { useAuth } from '@/lib/auth-context';
import { SplashScreen } from '@/components/SplashScreen';

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
const APPLE_CLIENT_ID = import.meta.env.VITE_APPLE_CLIENT_ID as string | undefined;

export default function Auth() {
  const navigate = useNavigate();
  const { login, register, loginWithGoogle, loginWithApple } = useAuth();
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const next = safeNext(window.location.search);
  const nextRef = useRef(next);
  nextRef.current = next;

  // Post-login transition: hold the splash briefly, fade it out, then land
  // on the destination page. Shared by every sign-in path below.
  const [transitioning, setTransitioning] = useState(false);
  const [transitionFadeOut, setTransitionFadeOut] = useState(false);
  const completeLogin = (destination: string) => {
    setTransitioning(true);
    setTimeout(() => setTransitionFadeOut(true), 700);
    setTimeout(() => navigate(destination), 1200);
  };

  // Google Identity Services: initialize once the script has loaded, with a
  // callback that hands us an ID token to verify server-side.
  useEffect(() => {
    if (!GOOGLE_CLIENT_ID) return;
    const tryInit = () => {
      if (!window.google) return false;
      window.google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: async (response) => {
          setLoading(true);
          try {
            await loginWithGoogle(response.credential);
            toast.success('Welcome!');
            completeLogin(nextRef.current);
          } catch (err: unknown) {
            toast.error(errorMessage(err, 'Could not sign in with Google.'));
          } finally {
            setLoading(false);
          }
        },
      });
      return true;
    };
    if (!tryInit()) {
      const interval = setInterval(() => { if (tryInit()) clearInterval(interval); }, 200);
      return () => clearInterval(interval);
    }
  }, [loginWithGoogle, navigate]);

  const handleEmailSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await register(email, password, displayName);
      const firstName = displayName.trim().split(/\s+/)[0];
      toast.success(firstName ? `Welcome, ${firstName}!` : 'Welcome!');
      completeLogin(next);
    } catch (err: unknown) {
      toast.error(errorMessage(err, 'Could not create account.'));
    } finally {
      setLoading(false);
    }
  };

  const handleEmailSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await login(email, password);
      toast.success('Welcome back!');
      completeLogin(next);
    } catch (err: unknown) {
      toast.error(errorMessage(err, 'Could not sign in.'));
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = () => {
    if (!GOOGLE_CLIENT_ID) {
      toast.error('Google sign-in is not configured (missing VITE_GOOGLE_CLIENT_ID).');
      return;
    }
    if (!window.google) {
      toast.error('Google sign-in is still loading — try again in a moment.');
      return;
    }
    window.google.accounts.id.prompt();
  };

  const handleAppleSignIn = async () => {
    if (!APPLE_CLIENT_ID) {
      toast.error('Apple sign-in is not configured (missing VITE_APPLE_CLIENT_ID).');
      return;
    }
    if (!window.AppleID) {
      toast.error('Apple sign-in is still loading — try again in a moment.');
      return;
    }
    setLoading(true);
    try {
      window.AppleID.auth.init({
        clientId: APPLE_CLIENT_ID,
        scope: 'name email',
        redirectURI: window.location.origin,
        usePopup: true,
      });
      const result = await window.AppleID.auth.signIn();
      await loginWithApple(result.authorization.id_token);
      toast.success('Welcome!');
      completeLogin(next);
    } catch (err: unknown) {
      toast.error(errorMessage(err, 'Could not sign in with Apple.'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen pt-safe flex items-center justify-center bg-background p-4">
      {transitioning && <SplashScreen fadeOut={transitionFadeOut} />}
      <Card className="w-full max-w-md p-8 shadow-elegant animate-in fade-in-0 slide-in-from-bottom-6 duration-700">
        <div className="text-center mb-8">
          <Phone className="h-12 w-12 mx-auto mb-4 text-primary" />
          <h1 className="text-3xl font-bold text-foreground mb-2">Kall Konnect</h1>
          <p className="text-sm text-muted-foreground">Smart reminders that help you call, connect, and care — effortlessly.</p>
        </div>

        <Tabs defaultValue="signin" className="w-full">
          <TabsList className="grid w-full grid-cols-2 mb-8">
            <TabsTrigger value="signin">Sign In</TabsTrigger>
            <TabsTrigger value="signup">Sign Up</TabsTrigger>
          </TabsList>

          <TabsContent value="signin">
            <form onSubmit={handleEmailSignIn} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="signin-email">Email</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="signin-email"
                    type="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="pl-10"
                    required
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="signin-password">Password</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="signin-password"
                    type="password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="pl-10"
                    required
                  />
                </div>
              </div>

              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? 'Signing in...' : 'Sign In'}
              </Button>
            </form>
          </TabsContent>

          <TabsContent value="signup">
            <form onSubmit={handleEmailSignUp} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="signup-name">Display Name</Label>
                <div className="relative">
                  <User className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="signup-name"
                    type="text"
                    placeholder="Your name"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    className="pl-10"
                    required
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="signup-email">Email</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="signup-email"
                    type="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="pl-10"
                    required
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="signup-password">Password</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="signup-password"
                    type="password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="pl-10"
                    required
                    minLength={6}
                  />
                </div>
              </div>

              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? 'Creating account...' : 'Sign Up'}
              </Button>
            </form>
          </TabsContent>
        </Tabs>

        <div className="relative my-6">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-border"></div>
          </div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-card px-2 text-muted-foreground">Or continue with</span>
          </div>
        </div>

        <div className="space-y-3">
          <Button
            variant="outline"
            className="w-full"
            onClick={handleGoogleSignIn}
            disabled={loading}
          >
            <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24">
              <path
                fill="currentColor"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              />
              <path
                fill="currentColor"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path
                fill="currentColor"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
              />
              <path
                fill="currentColor"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              />
            </svg>
            Sign in with Google
          </Button>

          <Button
            variant="outline"
            className="w-full"
            onClick={handleAppleSignIn}
            disabled={loading}
          >
            <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
              <path d="M17.05 20.28c-.98 1.32-2.09 2.5-3.56 2.53-1.46.04-1.88-.88-3.52-.88-1.63 0-2.14.85-3.49.91-1.4.06-2.47-1.35-3.45-2.68-1.88-2.63-3.3-7.45-1.38-10.7 1.3-2.27 3.64-3.71 6.17-3.75 1.5-.03 2.91.97 3.83.97.92 0 2.63-1.21 4.44-1.03.75.03 2.86.3 4.22 2.3-.11.07-2.52 1.45-2.49 4.33.03 3.46 3.04 4.61 3.07 4.63-.03.1-.48 1.63-1.57 3.25-.95 1.42-1.93 2.84-3.39 2.86-1.41.02-1.87-.9-3.48-.9-1.62 0-2.13.92-3.52.9-1.2-.02-2.05-.55-3.04-1.7zm-2.78-15.1c.72-1.04 1.21-2.48 1.07-3.91-1.04.04-2.3.69-3.05 1.57-.67.77-1.25 2.01-1.09 3.2 1.16.09 2.34-.74 3.07-1.86z" />
            </svg>
            Sign in with Apple
          </Button>
        </div>
      </Card>
    </div>
  );
}
