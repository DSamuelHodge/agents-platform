import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authorize, tierOf } from './authorize.ts';
import { mcpTokenSecretName } from './secrets.ts';
import type { PolicyBundle } from './types.ts';

const bundle: PolicyBundle = {
  version: 1,
  catalog: {
    github: { url: 'https://x/github', overrides: { merge_pull_request: 'admin', comment_issue: 'write' } },
  },
  departments: {
    eng: {
      servers: { github: { maxTier: 'write', deny: ['create_gist'] } },
      roles: {
        'role/lead': { servers: { github: { tier: 'write' } } },
        'role/reader': { servers: { github: { tier: 'read' } } },
        'role/narrow': { servers: { github: { tier: 'write', tools: ['get_issue'] } } },
      },
    },
    legal: { servers: {}, roles: { 'role/counsel': { servers: {} } } },
  },
};

test('tier classification defaults to admin for unknown verbs', () => {
  const s = bundle.catalog.github!;
  assert.equal(tierOf(s, 'get_issue'), 'read');
  assert.equal(tierOf(s, 'create_issue'), 'write');
  assert.equal(tierOf(s, 'delete_repo'), 'admin');
  assert.equal(tierOf(s, 'merge_pull_request'), 'admin');
  assert.equal(tierOf(s, 'getJiraIssue'), 'read');
  assert.equal(tierOf(s, 'createLead'), 'write');
  assert.equal(tierOf(s, 'list-accounts'), 'read');
  assert.equal(tierOf(s, 'deleteAccount'), 'admin');
  assert.equal(tierOf(s, 'download_file_content'), 'read');
  assert.equal(tierOf(s, 'copy_file'), 'write');
});

test('role grant and department ceiling both apply', () => {
  assert.equal(authorize(bundle, 'eng', 'role/lead', 'github', 'create_issue').allow, true);
  assert.equal(authorize(bundle, 'eng', 'role/reader', 'github', 'create_issue').allow, false);
  assert.equal(authorize(bundle, 'eng', 'role/lead', 'github', 'delete_repo').allow, false);
  assert.equal(authorize(bundle, 'eng', 'role/lead', 'github', 'create_gist').allow, false);
  assert.equal(authorize(bundle, 'eng', 'role/narrow', 'github', 'get_issue').allow, true);
  assert.equal(authorize(bundle, 'eng', 'role/narrow', 'github', 'list_issues').allow, false);
});

test('upstream secret names are per department and server', () => {
  assert.equal(mcpTokenSecretName('sales', 'salesforce'), 'MCP_TOKEN_SALES_SALESFORCE');
  assert.equal(mcpTokenSecretName('legal-compliance', 'google-drive'), 'MCP_TOKEN_LEGAL_COMPLIANCE_GOOGLE_DRIVE');
});

test('cross-department and unknown identities are denied', () => {
  assert.equal(authorize(bundle, 'legal', 'role/counsel', 'github', 'get_issue').allow, false);
  assert.equal(authorize(bundle, 'legal', 'role/lead', 'github', 'get_issue').allow, false);
  assert.equal(authorize(bundle, 'eng', 'role/ghost', 'github', 'get_issue').allow, false);
  assert.equal(authorize(bundle, 'eng', 'role/lead', 'nope', 'get_issue').allow, false);
  assert.equal(authorize(bundle, 'nope', 'role/lead', 'github', 'get_issue').allow, false);
});
