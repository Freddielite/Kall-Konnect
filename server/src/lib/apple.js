import { createRemoteJWKSet, jwtVerify } from 'jose';
import { env } from '../env.js';

const APPLE_JWKS = createRemoteJWKSet(new URL('https://appleid.apple.com/auth/keys'));

/**
 * Verifies a "Sign in with Apple" ID token (from AppleID.auth.signIn() on the
 * frontend) and returns { sub, email } on success, or throws on failure.
 *
 * Note: Apple only includes `email` on the *first* sign-in for a given user/
 * client pair. If you need it later, capture it from the initial callback
 * and store it — Apple won't resend it.
 */
export async function verifyAppleIdToken(idToken) {
  if (!env.appleClientId) {
    throw new Error('APPLE_CLIENT_ID is not configured on the server');
  }
  const { payload } = await jwtVerify(idToken, APPLE_JWKS, {
    issuer: 'https://appleid.apple.com',
    audience: env.appleClientId,
  });
  return {
    sub: payload.sub,
    email: payload.email ?? null,
  };
}
