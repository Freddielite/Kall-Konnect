import { useState, useEffect, useCallback } from 'react';
import { api, API_URL, ensureFreshAccessToken } from '@/lib/api';
import { getAccessToken } from '@/lib/session-store';

interface GoogleCalendarStatus {
  connected: boolean;
  email: string | null;
}

export const useGoogleCalendar = () => {
  const [status, setStatus] = useState<GoogleCalendarStatus>({ connected: false, email: null });
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const data = await api.get<GoogleCalendarStatus>('/google-calendar/status');
      setStatus(data);
    } catch (error) {
      console.error('Error fetching Google Calendar status:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // A real top-level navigation, not fetch — /google-calendar/connect
  // requires the session and then 302s straight to Google, which a fetch()
  // call can't follow across origins in a way that lets the user actually
  // interact with Google's consent screen.
  //
  // A navigation carries no Authorization header, so on browsers that
  // blocked our cookies (iOS/Safari — see lib/session-store.ts) there'd be
  // no credential at all and this would 401. Those clients append the
  // short-lived access token instead; the server trades it for the signed
  // state param immediately. Refresh first, since an expired token here
  // fails as a redirect to /settings?calendar=error rather than a retryable
  // 401.
  const connect = async () => {
    await ensureFreshAccessToken();
    const token = getAccessToken();
    const url = new URL(`${API_URL}/google-calendar/connect`);
    if (token) url.searchParams.set('access_token', token);
    window.location.href = url.toString();
  };

  const disconnect = async () => {
    await api.post('/google-calendar/disconnect');
    setStatus({ connected: false, email: null });
  };

  return { status, loading, connect, disconnect, refresh };
};
