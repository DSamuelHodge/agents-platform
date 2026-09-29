/** Worker secret holding the upstream MCP credential for one department × catalog server. */
export function mcpTokenSecretName(department: string, serverId: string): string {
  const snake = (s: string) => s.toUpperCase().replace(/-/g, '_');
  return `MCP_TOKEN_${snake(department)}_${snake(serverId)}`;
}
