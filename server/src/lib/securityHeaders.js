import { env } from '../env.js';

/**
 * Security headers on every response. This server only ever returns JSON
 * or redirects, never HTML, so the policy can be as strict as it gets: no
 * content may load from a response, and nothing may frame it. (The app's
 * pages are served by Vercel; their headers live in /vercel.json.)
 *
 * Written out rather than pulled from `helmet` so it's one short file with
 * no dependency to keep patched.
 */
export function securityHeaders(req, res, next) {
  res.set({
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  });
  // Only over HTTPS: sent on plain-http localhost it would make the browser
  // refuse http://localhost for a year.
  if (env.isProduction) {
    res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
}
