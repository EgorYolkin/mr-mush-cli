export function getEnabledMcpServers(config) {
  const servers = config.mcp?.servers ?? {};

  return Object.entries(servers)
    .filter(([, server]) => server.enabled)
    .map(([id, server]) => ({
      id,
      enabled: server.enabled,
      transport: server.transport,
      command: server.command,
      args: server.args ?? [],
      url: server.url,
      env: server.env ?? {},
    }));
}
