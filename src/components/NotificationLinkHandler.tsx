import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/lib/auth-context';
import { useToast } from '@/hooks/use-toast';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/utils';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Handles the parameters a reminder's link carries (see pushTargets in
 * server/src/jobs/generateNotifications.js):
 *
 *   kkn=<id>          the app was opened from this reminder: recorded, for
 *                     `npm run reminder-report`, and marked read
 *   action=snooze     "Remind me tomorrow", when the service worker had to
 *                     open the app to do it
 *   action=call       left in place for the contact page, which offers to dial
 *
 * Then removes what it handled from the URL, so a reload or Back doesn't
 * repeat it. Renders nothing.
 */
export function NotificationLinkHandler() {
  const location = useLocation();
  const navigate = useNavigate();
  const { session } = useAuth();
  const { toast } = useToast();
  const handled = useRef(new Set<string>());

  useEffect(() => {
    if (!session) return;
    const params = new URLSearchParams(location.search);
    const id = params.get('kkn');
    if (!id || !UUID.test(id) || handled.current.has(id)) return;
    handled.current.add(id);

    const action = params.get('action');
    api.post(`/notifications/${id}/opened`).catch(() => {});
    if (action === 'snooze') {
      api.post<{ remindOn: string }>(`/notifications/${id}/remind-tomorrow`)
        .then(() => toast({ title: "We'll remind you tomorrow" }))
        .catch((err) => toast({ title: "Couldn't set that reminder", description: errorMessage(err), variant: 'destructive' }));
    }

    params.delete('kkn');
    if (action === 'snooze') params.delete('action');
    const search = params.toString();
    navigate({ pathname: location.pathname, search: search ? `?${search}` : '' }, { replace: true });
  }, [location.pathname, location.search, navigate, session, toast]);

  return null;
}
