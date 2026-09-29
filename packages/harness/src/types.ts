import type { Skill } from '@flue/runtime';
import type { Tier } from '@org/policy-core';

export interface RoleMcpGrant {
  /** Catalog server id (see mcp-catalog.json). */
  id: string;
  tier: Tier;
  /** Optional explicit tool allowlist, narrower than the tier. */
  tools?: string[];
}

/** Source of truth for one role. Lives in departments/<dept>/roles/<slug>.json. */
export interface RoleManifest {
  /** e.g. `role/product-manager` */
  label: string;
  roleId: string;
  name: string;
  department: string;
  departmentTitle: string;
  lead: boolean;
  persona: string;
  model: string;
  thinkingLevel?: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  skills: string[];
  mcp: RoleMcpGrant[];
  /** Lead only: same-department role slugs this role may hand work to. */
  delegatesTo?: string[];
}

export interface RoleDefinition {
  manifest: RoleManifest;
  /** Statically imported SKILL.md references (Flue requires static imports). */
  skills: Skill[];
}
