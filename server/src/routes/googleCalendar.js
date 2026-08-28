import { Router } from 'express';
import { query } from '../db.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { env } from '../env.js';
import {
  signCalendarState,
  verifyCalendarState,
  buildCalendarAuthUrl,
  exchangeCodeForTokens,
  fetchGoogleAccountEmail,
  disconnectGoogleCalendar,
} from '../lib/googleCalendar.js';

export const googleCalendarRouter = Router();

// Authenticated: the Settings page navigates the browser here directly
// (window.location.href = ..., a real top-level navigation, not fetch) so
// the auth cookie rides along. Redirects straight to Google's consent
// screen with a signed, short-lived state token carrying the userId, since
// /callback below has no guarantee of a live session by the time Google
// redirects back.
googleCalendarRouter.get('/google-calendar/connect', requireAuth, async (req, res) => {
  try {
    const state = await signCalendarState(req.userId);
    res.redirect(buildCalendarAuthUrl(state));
  } catch (err) {
    console.error('google-calendar connect error:', err);
    res.redirect(`${env.appUrl}/settings?calendar=error`);
  }
});

// Public: Google redirects here after the user approves/denies. No
// requireAuth — identity comes from the signed state param, not a cookie.
googleCalendarRouter.get('/google-calendar/callback', async (req, res) => {
  const { code, state, error } = req.query;

  if (error) {
    // Most commonly 'access_denied' — the user clicked Cancel on Google's
    // consent screen. Not a bug, just decline gracefully.
    return res.redirect(`${env.appUrl}/settings?calendar=denied`);
  }
  if (!code || !state) return res.redirect(`${env.appUrl}/settings?calendar=error`);

  try {
    const userId = await verifyCalendarState(state);
    const tokens = await exchangeCodeForTokens(code);
    if (!tokens.refresh_token) {
      // Happens if the user had already granted this scope before and
      // Google decided not to reissue one — buildCalendarAuthUrl sets
      // prompt=consent specifically to avoid this, but it's a hard
      // Google-side guarantee, not a promise, so handle it anyway.
      console.error('google-calendar callback: no refresh_token in response — re-consent required');
      return res.redirect(`${env.appUrl}/settings?calendar=error`);
    }

    const email = await fetchGoogleAccountEmail(tokens.access_token);

    await query(
      `UPDATE users
       SET google_calendar_refresh_token = $1, google_calendar_connected_at = now(), google_calendar_email = $2
       WHERE id = $3`,
      [tokens.refresh_token, email, userId]
    );

    res.redirect(`${env.appUrl}/settings?calendar=connected`);
  } catch (err) {
    console.error('google-calendar callback error:', err);
    res.redirect(`${env.appUrl}/settings?calendar=error`);
  }
});

googleCalendarRouter.get('/google-calendar/status', requireAuth, async (req, res) => {
  const { rows } = await query(
    'SELECT google_calendar_connected_at, google_calendar_email FROM users WHERE id = $1',
    [req.userId]
  );
  res.json({
    connected: Boolean(rows[0]?.google_calendar_connected_at),
    email: rows[0]?.google_calendar_email ?? null,
  });
});

googleCalendarRouter.post('/google-calendar/disconnect', requireAuth, async (req, res) => {
  await disconnectGoogleCalendar(req.userId);
  res.json({ ok: true });
});
