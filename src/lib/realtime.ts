import { useEffect, useRef } from 'react';
import { WS_URL, ensureFreshAccessToken } from './api';
import { getAccessToken } from './session-store';
import { useAuth } from './auth-context';

/** Opens a WebSocket authenticated with the current session and calls
 * `onMessage` for every event the server pushes. Reconnects with backoff if
 * the connection drops. Mirrors how the app used Supabase Realtime purely
 * as a "something changed, go refetch" signal. */
export function useRealtime(onMessage: (event: { type: string }) => void) {
  const { session } = useAuth();
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  useEffect(() => {
    if (!session) return;

    let socket: WebSocket | null = null;
    let closedByUs = false;
    let retryDelay = 1000;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    // The WebSocket API can't set headers, so where cookies are blocked
    // (iOS/Safari — see session-store.ts) the access token goes in the
    // query string instead; the server accepts either. Refresh first if
    // it's close to expiry: the handshake either succeeds or the socket is
    // closed, there's no 401 to retry on the way a fetch has.
    const connect = async () => {
      await ensureFreshAccessToken();
      if (closedByUs) return;

      const token = getAccessToken();
      const url = token
        ? `${WS_URL}/ws?access_token=${encodeURIComponent(token)}`
        : `${WS_URL}/ws`;
      socket = new WebSocket(url);
      socket.onmessage = (event) => {
        try {
          onMessageRef.current(JSON.parse(event.data));
        } catch {
          // ignore malformed frames
        }
      };
      socket.onopen = () => { retryDelay = 1000; };
      socket.onclose = () => {
        if (closedByUs) return;
        retryTimer = setTimeout(connect, retryDelay);
        retryDelay = Math.min(retryDelay * 2, 30_000);
      };
    };

    void connect();

    return () => {
      closedByUs = true;
      clearTimeout(retryTimer);
      socket?.close();
    };
  }, [session]);
}
