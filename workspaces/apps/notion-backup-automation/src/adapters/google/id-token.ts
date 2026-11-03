import type { OAuth2Client } from 'google-auth-library';

/** The identity a verified ID token names. The address is never logged or shown. */
export interface GoogleIdentity {
  readonly email: string;
  readonly emailVerified: boolean;
}

/**
 * The ID token failed verification: signature, issuer, expiry or audience. The library's own
 * messages hold the whole token, so none is kept.
 */
export class IdTokenError extends Error {
  constructor(message = 'The Google ID token failed verification') {
    super(message);
    this.name = 'IdTokenError';
  }
}

/**
 * Verifies an ID token with Google's published keys (`google-auth-library`): its signature, a
 * Google issuer, its lifetime, and `aud` = the Web client.
 */
export async function verifyIdToken(
  client: OAuth2Client,
  idToken: string,
  audience: string,
): Promise<GoogleIdentity> {
  let payload;

  try {
    const ticket = await client.verifyIdToken({ audience, idToken });

    payload = ticket.getPayload();
  } catch {
    throw new IdTokenError();
  }

  if (typeof payload?.email !== 'string' || payload.email === '') {
    throw new IdTokenError('The Google ID token names no email address');
  }

  return { email: payload.email, emailVerified: payload.email_verified === true };
}

/** `OWNER_GOOGLE_EMAIL`, verified by Google: the only account that may sign in or re-login. */
export function isOwner(identity: GoogleIdentity, ownerEmail: string): boolean {
  return identity.emailVerified && identity.email.toLowerCase() === ownerEmail.toLowerCase();
}
