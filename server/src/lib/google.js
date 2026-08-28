import { createRemoteJWKSet, jwtVerify } from 'jose';
import { env } from '../env.js';

const GOOGLE_JWKS = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));

/**
 * Verifies a Google Identity Services ID token (the credential the frontend
 * gets from Google's `Sign in with Google` button) and returns
 * { sub, email, name } on success, or throws on failure.
 */
export async function verifyGoogleIdToken(idToken) {
  if (!env.googleClientId) {
    throw new Error('GOOGLE_CLIENT_ID is not configured on the server');
  }
  const { payload } = await jwtVerify(idToken, GOOGLE_JWKS, {
    issuer: ['https://accounts.google.com', 'accounts.google.com'],
    audience: env.googleClientId,
  });
  return {
    sub: payload.sub,
    email: payload.email,
    name: payload.name ?? payload.email,
  };
}
