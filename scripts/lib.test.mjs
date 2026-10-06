import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  collectPresentMcpTokenNames,
  mcpTokenSecretName,
  mountedMcpGrants,
  parseDotEnv,
} from './lib.mjs';

test('parseDotEnv skips comments and unwraps quotes', () => {
  const got = parseDotEnv('# hi\nMCP_TOKEN_X=abc\nMCP_TOKEN_Y="de f"\n\nexport ignored\n');
  assert.equal(got.MCP_TOKEN_X, 'abc');
  assert.equal(got.MCP_TOKEN_Y, 'de f');
  assert.equal(got.export, undefined);
});

test('collectPresentMcpTokenNames prefers live env over the committed inventory', () => {
  const present = ['MCP_TOKEN_BACKEND_DEVELOPMENT_JIRA'];
  const fromFile = collectPresentMcpTokenNames({
    env: {},
    envFileText: '',
    present,
  });
  assert.deepEqual(fromFile, present);

  const live = collectPresentMcpTokenNames({
    env: { MCP_TOKEN_BACKEND_DEVELOPMENT_GITHUB: 'ghp_x', PATH: '/bin' },
    envFileText: 'MCP_TOKEN_BACKEND_DEVELOPMENT_CLOUDFLARE=cf_x\n',
    present,
  });
  assert.deepEqual(live, [
    'MCP_TOKEN_BACKEND_DEVELOPMENT_CLOUDFLARE',
    'MCP_TOKEN_BACKEND_DEVELOPMENT_GITHUB',
  ]);
});

test('empty live values do not count as present', () => {
  const names = collectPresentMcpTokenNames({
    env: { MCP_TOKEN_BACKEND_DEVELOPMENT_JIRA: '  ' },
    envFileText: 'MCP_TOKEN_BACKEND_DEVELOPMENT_SENTRY=\n',
    present: ['MCP_TOKEN_BACKEND_DEVELOPMENT_GITHUB'],
  });
  assert.deepEqual(names, ['MCP_TOKEN_BACKEND_DEVELOPMENT_GITHUB']);
});

test('mountedMcpGrants keeps only servers with a department token', () => {
  const grants = [
    { id: 'github', tier: 'read' },
    { id: 'jira', tier: 'read' },
    { id: 'sentry', tier: 'read' },
    { id: 'cloudflare', tier: 'read' },
  ];
  const present = [
    mcpTokenSecretName('backend-development', 'github'),
    mcpTokenSecretName('backend-development', 'cloudflare'),
  ];
  assert.deepEqual(mountedMcpGrants('backend-development', grants, present), [
    { id: 'github', tier: 'read' },
    { id: 'cloudflare', tier: 'read' },
  ]);
  assert.deepEqual(mountedMcpGrants('sales', grants, present), []);
});
