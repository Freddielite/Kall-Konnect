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
    if (!req.url?.startsWith('/ws')) return; // let other upgrade handlers (if any) deal with it

    const cookies = parseCookieHeader(req.headers.cookie);
    const token = cookies[ACCESS_COOKIE];
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
