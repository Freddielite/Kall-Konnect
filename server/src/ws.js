import { WebSocketServer } from 'ws';
import { verifyAccessToken } from './lib/tokens.js';
import { ACCESS_COOKIE } from './lib/cookies.js';

const userSockets = new Map(); // userId -> Set<WebSocket>

/** Tiny cookie-header parser — avoids pulling in a dependency just for
 * this one read on the raw upgrade request (cookie-parser is Express
 * middleware and doesn't apply to the raw http.Server 'upgrade' event). */
function parseCookieHeader(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(value);
  }
  return out;
}

export function attachWebSocketServer(httpServer) {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', async (req, socket, head) => {
    // Path only — the URL may now carry a ?access_token=... query string.
    if (!req.url || !/^\/ws(\?|$|\/)/.test(req.url)) return; // let other upgrade handlers (if any) deal with it

    // The browser WebSocket API cannot set request headers, so a client
    // whose cookies were blocked (iOS/Safari — see lib/session.js) has no
    // way to send `Authorization` here. A query param is the only channel
    // available. It is acceptable because this is an access token, not the
    // refresh token: it expires in ACCESS_TOKEN_TTL_SECONDS (15 min by
    // default) and cannot be used to mint a new one. Clients that do have
    // working cookies never send it.
    const cookies = parseCookieHeader(req.headers.cookie);
    const query = new URL(req.url, 'http://localhost').searchParams;
    const token = cookies[ACCESS_COOKIE] ?? query.get('access_token') ?? undefined;
    const userId = token ? await verifyAccessToken(token) : null;
    if (!userId) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.userId = userId;
      if (!userSockets.has(userId)) userSockets.set(userId, new Set());
      userSockets.get(userId).add(ws);

      ws.on('close', () => {
        userSockets.get(userId)?.delete(ws);
        if (userSockets.get(userId)?.size === 0) userSockets.delete(userId);
      });
    });
  });

  return wss;
}

/** Notify every open connection for a user that something changed. The
 * frontend just refetches the relevant resource on receipt — this mirrors
 * how the app used Supabase Realtime purely as a "something changed" ping. */
export function broadcastToUser(userId, event) {
  const sockets = userSockets.get(userId);
  if (!sockets) return;
  const payload = JSON.stringify(event);
  for (const ws of sockets) {
    if (ws.readyState === ws.OPEN) ws.send(payload);
  }
}
