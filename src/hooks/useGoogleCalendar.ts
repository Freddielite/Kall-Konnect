import { useState, useEffect, useCallback } from 'react';
import { api, API_URL } from '@/lib/api';

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
  // requires the session cookie and then 302s straight to Google, which a
  // fetch() call can't follow across origins in a way that lets the user
  // actually interact with Google's consent screen.
  const connect = () => {
    window.location.href = `${API_URL}/google-calendar/connect`;
  };

  const disconnect = async () => {
    await api.post('/google-calendar/disconnect');
    setStatus({ connected: false, email: null });
  };

  return { status, loading, connect, disconnect, refresh };
};
