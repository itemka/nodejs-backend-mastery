import { randomUUID, randomBytes } from 'node:crypto';
import { v7 as uuidv7 } from 'uuid';

// Primary keys
export function generateId(): string {
  return uuidv7();
}

// Correlation / tracing / idempotency
export function generateCorrelationId(): string {
  return randomUUID();
}

// Opaque secrets (tokens) – store only a hash of this value
export function generateSecretToken(size = 32): string {
  return randomBytes(size).toString('base64url'); // 32 bytes ≈ 43 chars
}
