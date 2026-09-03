import { useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/lib/auth-context';
import { syncPushSubscription } from '@/lib/push';

interface ProtectedRouteProps {
  children: React.ReactNode;
}

export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { session, loading } = useAuth();

  // Re-register this device for push once per authenticated session.
  //
  // A subscription can go missing without the user doing anything wrong —
  // site data cleared, VAPID keys added to the server after they first
  // enabled reminders, or (the common one) they never subscribed at all
  // because the Settings switch defaults to ON and so its onChange, which is
  // the only thing that subscribes, never fired.
  //
  // Safe to run unconditionally: it no-ops unless notification permission has
  // already been granted, so it can never surface a surprise prompt on load.
  useEffect(() => {
    if (!session) return;
    void syncPushSubscription();
  }, [session]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-pulse text-center">
          <div className="h-8 w-8 rounded-full bg-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  if (!session) {
    return <Navigate to="/auth" replace />;
  }

  return <>{children}</>;
}
