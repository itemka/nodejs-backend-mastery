/** `1//0gAbC…xYz4`-style fingerprint: enough to tell tokens apart, too little to use one. */
export function maskToken(token: string): string {
  return token.length < 16 ? '…' : `${token.slice(0, 5)}…${token.slice(-4)}`;
}

/** `person@example.com` → `p***@example.com`. Anything that is not an address is fully masked. */
export function maskEmail(address: string): string {
  const at = address.lastIndexOf('@');

  if (at < 1 || at === address.length - 1) {
    return '***';
  }

  return `${address.slice(0, 1)}***${address.slice(at)}`;
}
