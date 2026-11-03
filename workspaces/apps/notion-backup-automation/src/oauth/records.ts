import { z } from 'zod';

/*
 * What the phone re-login keeps in Redis, and for how long: the PKCE verifier of each Google
 * sign-in in flight, stored under its state's SHA-256 only.
 */

/** From `/oauth/google/reauth` to Google's callback. */
export const LOGIN_TTL_SEC = 15 * 60;

/** A sign-in state: random bits, base64url (`randomSecret`). */
export const stateSchema = z.string().regex(/^[\w-]{22,64}$/);

/** A Google consent in flight: its PKCE verifier, kept server-side until the callback. */
export const loginRecordSchema = z.object({ codeVerifier: z.string() });

export type LoginRecord = z.infer<typeof loginRecordSchema>;
