import { SignJWT, jwtVerify } from 'jose';
import { env } from '../env.js';
import { query } from '../db.js';

const secretKey = new TextEncoder().encode(env.jwtSecret);

// Read/write access to events only — deliberately narrower than full
// Calendar scope, since this app only ever creates reminder events.
const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events';

function assertConfigured() {
  if (!env.googleClientId || !env.googleClientSecret) {
    throw new Error(
      'Google Calendar is not configured on the server: GOOGLE_CLIENT_ID and ' +
        'GOOGLE_CLIENT_SECRET (server/.env) are both required. The client ID can ' +
        'be the same one used for Sign in with Google; the secret is separate — ' +
        'grab it from the same OAuth Client ID page in Google Cloud Console.'
    );
  }
}

/** Short-lived signed state param carrying the userId through the Google
 * redirect round trip, so /google-calendar/callback (which Google calls
 * with no session cookie guaranteed) knows who to attach the tokens to. */
export async function signCalendarState(userId) {
  return new SignJWT({ sub: userId, purpose: 'google-calendar-connect' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(secretKey);
}

export async function verifyCalendarState(state) {
  const { payload } = await jwtVerify(state, secretKey);
  if (payload.purpose !== 'google-calendar-connect') throw new Error('Wrong token purpose');
  return payload.sub;
}

export function buildCalendarAuthUrl(state) {
  assertConfigured();
  const params = new URLSearchParams({
    client_id: env.googleClientId,
    redirect_uri: env.googleCalendarRedirectUri,
    response_type: 'code',
    scope: CALENDAR_SCOPE,
    access_type: 'offline', // required to get a refresh_token back
    prompt: 'consent', // forces a fresh refresh_token every time; without it,
    // a user who connected before gets no refresh_token on a second grant
    include_granted_scopes: 'false',
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

async function tokenRequest(body) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      `Google token endpoint rejected the request (HTTP ${res.status}): ${
        data.error_description || data.error || 'unknown error'
      }`
    );
  }
  return data;
}

export async function exchangeCodeForTokens(code) {
  assertConfigured();
  return tokenRequest({
    code,
    client_id: env.googleClientId,
    client_secret: env.googleClientSecret,
    redirect_uri: env.googleCalendarRedirectUri,
    grant_type: 'authorization_code',
  });
}

async function refreshAccessToken(refreshToken) {
  assertConfigured();
  const data = await tokenRequest({
    refresh_token: refreshToken,
    client_id: env.googleClientId,
    client_secret: env.googleClientSecret,
    grant_type: 'refresh_token',
  });
  return data.access_token;
}

/** Fetches the connected Google account's email — shown in Settings so the
 * user can tell which account they connected without guessing. */
export async function fetchGoogleAccountEmail(accessToken) {
  const res = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  const data = await res.json().catch(() => ({}));
  return data.email ?? null;
}

/** Returns a live access token for this user's connected calendar, or null
 * if they haven't connected one. Refreshes on every call — access tokens
 * are only good for ~1 hour and Calendar pushes happen from a background
 * cron job with no session to piggyback a refresh off of. */
export async function getValidAccessToken(userId) {
  const { rows } = await query('SELECT google_calendar_refresh_token FROM users WHERE id = $1', [userId]);
  const refreshToken = rows[0]?.google_calendar_refresh_token;
  if (!refreshToken) return null;
  return refreshAccessToken(refreshToken);
}

/**
 * Creates (or updates, if eventId is given) a Calendar event and returns its
 * id. 30-minute default duration, matching the .ics reminder invite.
 */
export async function upsertCalendarEvent({ accessToken, eventId, summary, description, start }) {
  const end = new Date(start.getTime() + 30 * 60 * 1000);
  const body = {
    summary,
    description,
    start: { dateTime: start.toISOString() },
    end: { dateTime: end.toISOString() },
  };

  const url = eventId
    ? `https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventId}`
    : 'https://www.googleapis.com/calendar/v3/calendars/primary/events';

  const res = await fetch(url, {
    method: eventId ? 'PATCH' : 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Google Calendar API rejected the event (HTTP ${res.status}): ${data.error?.message ?? 'unknown error'}`);
  }
  return data.id;
}

export async function disconnectGoogleCalendar(userId) {
  await query(
    `UPDATE users
     SET google_calendar_refresh_token = NULL, google_calendar_connected_at = NULL, google_calendar_email = NULL
     WHERE id = $1`,
    [userId]
  );
}
