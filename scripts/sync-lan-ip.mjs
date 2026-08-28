#!/usr/bin/env node
// Runs automatically before `npm run dev` / `npm start` (see the
// "predev"/"prestart" hooks in package.json and server/package.json).
//
// DHCP hands this machine a new LAN IP every time it reconnects to a
// network — that's what kept breaking VITE_API_URL / CORS_ORIGIN by hand.
// This script finds the current IP and rewrites both .env files to match,
// every time the dev servers start, so nobody has to notice or care that
// the IP moved.
//
// It's a mitigation, not a permanent fix — the real fix is a DHCP
// reservation / static IP for this machine on your router, so the address
// stops moving at all. Worth doing either way; this just means things
// keep working in the meantime.

import dgram from 'node:dgram';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// This is a local-development convenience only. On a hosting platform there
// is no LAN to sync: the container has an internal 10.x/172.x address that
// means nothing to a browser, and writing it into APP_URL/CORS_ORIGIN would
// bake a dead address into password-reset links. Platform env vars take
// precedence over .env anyway, but scaffolding a .env from .env.example also
// drags in placeholder values (EMAIL_FROM=you@example.com) for any var not
// set in the dashboard. So: bail out everywhere that isn't a dev machine.
const CI_MARKERS = ['RENDER', 'VERCEL', 'CI', 'FLY_APP_NAME', 'DYNO', 'AWS_EXECUTION_ENV', 'K_SERVICE'];
const platform = CI_MARKERS.find((k) => process.env[k]);
if (process.env.NODE_ENV === 'production' || platform) {
  console.log(
    `[sync-lan-ip] Skipped (${platform ? `${platform} detected` : 'NODE_ENV=production'}) — ` +
      'this is a local dev helper. Configure env vars in your hosting dashboard instead.'
  );
  process.exit(0);
}
const FRONTEND_ENV = path.join(ROOT, '.env');
const FRONTEND_ENV_EXAMPLE = path.join(ROOT, '.env.example');
const SERVER_ENV = path.join(ROOT, 'server', '.env');
const SERVER_ENV_EXAMPLE = path.join(ROOT, 'server', '.env.example');

const FRONTEND_PORT = 8080; // vite.config.ts
const BACKEND_PORT = 4000; // server/src/env.js default

// Interface names that are never the real LAN. `veth` also catches
// Windows' "vEthernet (WSL)" / "vEthernet (Default Switch)" case-insensitively.
const VIRTUAL_IFACE = /^(lo|docker|br-|veth|virbr|vmnet|vboxnet|utun|tailscale|zt|wg|ppp|awdl|llw|anpi|bridge|virtualbox|hyper-v|bluetooth)/i;

/**
 * Address ranges that look like a normal private LAN but are handed out by
 * something local-only, so nothing else on the network can reach them:
 *   192.168.56.x  VirtualBox host-only adapter
 *   192.168.137.x Windows Internet Connection Sharing / mobile hotspot
 *   169.254.x.x   APIPA link-local (DHCP failed - no usable network at all)
 * Picking one of these writes an address into VITE_API_URL that the browser
 * can never connect to. The request then hangs until the client-side
 * timeout fires, which is exactly the failure this script exists to prevent.
 */
const UNREACHABLE_RANGE = /^(192\.168\.56\.|192\.168\.137\.|169\.254\.)/;

function listCandidates() {
  const nets = os.networkInterfaces();
  const candidates = [];
  for (const [name, addrs] of Object.entries(nets)) {
    for (const addr of addrs ?? []) {
      const isV4 = addr.family === 'IPv4' || addr.family === 4;
      if (!isV4 || addr.internal) continue;
      candidates.push({
        name,
        address: addr.address,
        virtual: VIRTUAL_IFACE.test(name) || UNREACHABLE_RANGE.test(addr.address),
      });
    }
  }
  return candidates;
}

/**
 * Asks the OS which interface it would actually use to reach the outside
 * world, and reports that interface's address.
 *
 * `socket.connect()` on a UDP socket sends no packets - it only fixes the
 * local end of the association, which makes the kernel run its routing
 * table and bind the socket to the default-route interface. So this works
 * with no network traffic, needs no reachable host at 8.8.8.8, and returns
 * the one address that other devices on the LAN can actually reach.
 *
 * The name-and-range heuristics above are guesses about which adapter is
 * real; this is the authoritative answer. Heuristics stay as the fallback
 * for the offline case, where there is no default route to report.
 */
function detectViaDefaultRoute() {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      try { socket.close(); } catch { /* already closed */ }
      resolve(value);
    };

    const socket = dgram.createSocket('udp4');
    socket.on('error', () => finish(null));
    // Belt and braces: never let a wedged socket hang `npm run dev`.
    const timer = setTimeout(() => finish(null), 500);
    timer.unref?.();

    try {
      socket.connect(53, '8.8.8.8', () => {
        try {
          const { address } = socket.address();
          finish(address && address !== '0.0.0.0' ? address : null);
        } catch {
          finish(null);
        }
      });
    } catch {
      finish(null);
    }
  });
}

async function detectLanIp() {
  const candidates = listCandidates();

  // An explicit override always wins - the escape hatch for setups no
  // amount of autodetection gets right (multiple real NICs, VPN split
  // tunnels, a machine reachable only via a specific interface).
  if (process.env.LAN_IP) {
    return { ip: process.env.LAN_IP.trim(), how: 'LAN_IP override', candidates };
  }

  const routed = await detectViaDefaultRoute();
  if (routed && candidates.some((c) => c.address === routed)) {
    return { ip: routed, how: 'default route', candidates };
  }

  // Offline, or the default route points at something not in the interface
  // list (some VPNs). Fall back to the old heuristic, minus anything we can
  // identify as virtual.
  const byPreference = (ip) =>
    ip.startsWith('192.168.') ? 0 : ip.startsWith('10.') ? 1 : ip.startsWith('172.') ? 2 : 3;
  const real = candidates
    .filter((c) => !c.virtual)
    .sort((a, b) => byPreference(a.address) - byPreference(b.address));

  return { ip: real[0]?.address ?? null, how: 'heuristic fallback', candidates };
}

function setKey(content, key, value) {
  const line = `${key}=${value}`;
  const re = new RegExp(`^${key}=.*$`, 'm');
  if (re.test(content)) return content.replace(re, line);
  return content.replace(/\s*$/, '') + `\n${line}\n`;
}

function readOrScaffold(envPath, examplePath) {
  if (fs.existsSync(envPath)) return fs.readFileSync(envPath, 'utf8');
  if (fs.existsSync(examplePath)) return fs.readFileSync(examplePath, 'utf8');
  return '';
}

/** Origins pointing at a private IP address - i.e. a previous run's LAN
 * origin, which is now stale and worth dropping. Deliberately narrow: it
 * matches addresses, never hostnames. */
const STALE_LAN_ORIGIN = /^https?:\/\/(\d{1,3}\.){3}\d{1,3}(:\d+)?$/;

function mergeCorsOrigin(content, lanOrigin) {
  const re = /^CORS_ORIGIN=(.*)$/m;
  const match = content.match(re);
  const existing = match ? match[1].split(',').map((s) => s.trim()).filter(Boolean) : [];

  // Previously this kept *only* the two localhost origins, which silently
  // deleted anything hand-added - a deployed frontend's origin, a second
  // test device - every time the dev server started. Drop only the stale
  // IP-literal origins this script itself wrote; keep everything else.
  const kept = existing.filter((o) => !STALE_LAN_ORIGIN.test(o));
  const next = [...new Set([...kept, lanOrigin])];
  return setKey(content, 'CORS_ORIGIN', next.join(','));
}

const { ip, how, candidates } = await detectLanIp();
if (!ip) {
  console.warn('[sync-lan-ip] Could not detect a LAN IP — leaving .env files untouched.');
  if (candidates.length) {
    console.warn(`[sync-lan-ip] Saw only: ${candidates.map((c) => `${c.address} (${c.name})`).join(', ')}`);
  }
  console.warn('[sync-lan-ip] Set LAN_IP=<address> to choose one explicitly.');
  process.exit(0);
}

const lanFrontendOrigin = `http://${ip}:${FRONTEND_PORT}`;
const lanBackendUrl = `http://${ip}:${BACKEND_PORT}`;
const lanBackendWs = `ws://${ip}:${BACKEND_PORT}`;

// Frontend .env
let frontendEnv = readOrScaffold(FRONTEND_ENV, FRONTEND_ENV_EXAMPLE);
frontendEnv = setKey(frontendEnv, 'VITE_API_URL', lanBackendUrl);
frontendEnv = setKey(frontendEnv, 'VITE_WS_URL', lanBackendWs);
fs.writeFileSync(FRONTEND_ENV, frontendEnv);

// Backend .env
let serverEnv = readOrScaffold(SERVER_ENV, SERVER_ENV_EXAMPLE);
serverEnv = mergeCorsOrigin(serverEnv, lanFrontendOrigin);
serverEnv = setKey(serverEnv, 'APP_URL', lanFrontendOrigin);
fs.writeFileSync(SERVER_ENV, serverEnv);

console.log(`[sync-lan-ip] Detected LAN IP ${ip} via ${how} — synced into .env and server/.env.`);
console.log(`[sync-lan-ip] Frontend: ${lanFrontendOrigin}   Backend: ${lanBackendUrl}`);

// Choosing the wrong interface used to fail silently: the browser would
// load the app fine (Vite binds every interface) but every API call would
// hang until the client gave up. Show the alternatives so a wrong pick is
// visible here rather than as a mystery timeout in the UI.
const others = candidates.filter((c) => c.address !== ip);
if (others.length) {
  console.log(
    `[sync-lan-ip] Other addresses on this machine: ${others
      .map((c) => `${c.address} (${c.name}${c.virtual ? ', virtual' : ''})`)
      .join(', ')}`
  );
  console.log(`[sync-lan-ip] Wrong one? Re-run with LAN_IP=<address> npm run dev`);
}
