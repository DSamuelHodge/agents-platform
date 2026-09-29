export const TIERS = ['read', 'write', 'admin'] as const;
export type Tier = (typeof TIERS)[number];
export const tierRank = (t: Tier): number => TIERS.indexOf(t);

export interface CatalogServer {
  /** Upstream MCP endpoint (streamable HTTP). Only the gateway ever holds credentials for it. */
  url: string;
  description?: string;
  /** Regex source; tool names matching are `read`. */
  readPattern?: string;
  /** Regex source; tool names matching are `write`. Anything unmatched is `admin` (default-deny posture). */
  writePattern?: string;
  /** Exact tool-name → tier overrides. Wins over patterns. */
  overrides?: Record<string, Tier>;
}

/** Department ceiling for one server. */
export interface DeptServerGrant {
  maxTier: Tier;
  /** Tool names denied for the whole department regardless of tier. */
  deny?: string[];
}

/** Role-level grant; must be <= the department ceiling. */
export interface RoleServerGrant {
  tier: Tier;
  /** Optional explicit allowlist, further narrowing the tier. */
  tools?: string[];
}

export interface DepartmentPolicy {
  servers: Record<string, DeptServerGrant>;
  roles: Record<string, { servers: Record<string, RoleServerGrant> }>;
}

export interface PolicyBundle {
  version: number;
  catalog: Record<string, CatalogServer>;
  departments: Record<string, DepartmentPolicy>;
}
