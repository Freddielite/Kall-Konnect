import { useEffect, useRef } from 'react';
import { WS_URL } from './api';
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

    const connect = () => {
      socket = new WebSocket(`${WS_URL}/ws`);
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

    connect();

    return () => {
      closedByUs = true;
      clearTimeout(retryTimer);
      socket?.close();
    };
  }, [session]);
}
