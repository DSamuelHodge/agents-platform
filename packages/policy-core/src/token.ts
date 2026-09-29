export type Audience = 'mcp' | 'caller';

export interface TokenClaims {
  /** Department slug. */
  d: string;
  /** Role label, e.g. `role/product-manager`. */
  r?: string;
  /** Optional end-user subject, for audit. */
  sub?: string;
  aud: Audience;
  iat: number;
  exp: number;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

function b64urlEncode(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(input: string): Uint8Array {
  const pad = input.length % 4 === 0 ? '' : '='.repeat(4 - (input.length % 4));
  const bin = atob(input.replace(/-/g, '+').replace(/_/g, '/') + pad);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

const hmacKey = (secret: string, usages: KeyUsage[]) =>
  crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, usages);

export async function signToken(
  claims: Omit<TokenClaims, 'iat' | 'exp'>,
  secret: string,
  ttlSeconds = 300,
  nowMs = Date.now(),
): Promise<string> {
  const iat = Math.floor(nowMs / 1000);
  const payload = b64urlEncode(enc.encode(JSON.stringify({ ...claims, iat, exp: iat + ttlSeconds })));
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret, ['sign']), enc.encode(payload));
  return `${payload}.${b64urlEncode(new Uint8Array(sig))}`;
}

/** Read the (UNVERIFIED) department claim so the caller can select the right verification key. */
export function peekDepartment(token: string): string | null {
  try {
    const claims = JSON.parse(dec.decode(b64urlDecode(token.split('.')[0]!))) as Partial<TokenClaims>;
    return typeof claims.d === 'string' ? claims.d : null;
  } catch {
    return null;
  }
}

export async function verifyToken(
  token: string,
  secret: string,
  aud: Audience,
  nowMs = Date.now(),
): Promise<TokenClaims | null> {
  const [payload, sig, extra] = token.split('.');
  if (!payload || !sig || extra !== undefined) return null;
  try {
    const ok = await crypto.subtle.verify(
      'HMAC',
      await hmacKey(secret, ['verify']),
      b64urlDecode(sig),
      enc.encode(payload),
    );
    if (!ok) return null;
    const claims = JSON.parse(dec.decode(b64urlDecode(payload))) as TokenClaims;
    if (claims.aud !== aud) return null;
    if (Math.floor(nowMs / 1000) >= claims.exp) return null;
    return claims;
  } catch {
    return null;
  }
}
