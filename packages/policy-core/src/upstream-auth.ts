import type { CatalogServer } from './types.ts';

/** Build the upstream credential header. Default is `Authorization: Bearer <token>`. */
export function upstreamAuthHeader(server: Pick<CatalogServer, 'auth'>, credential: string): { name: string; value: string } {
  const name = server.auth?.header ?? 'Authorization';
  const scheme = server.auth?.scheme ?? 'Bearer';
  const value = /[=:]$/.test(scheme) ? `${scheme}${credential}` : `${scheme} ${credential}`;
  return { name, value };
}
