import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { z } from "zod";

const McpServerConfigSchema = z.object({
  command: z.string(),
  args: z.array(z.string()).optional().default([]),
  env: z.record(z.string()).optional()
});

const McpConfigSchema = z.object({ mcpServers: z.record(McpServerConfigSchema) });

export type McpConfig = z.infer<typeof McpConfigSchema>;

export interface McpConnection {
  name: string;
  client: Client;
  close: () => Promise<void>;
}

export function mcpConfigPath(workspacePath: string): string {
  return join(workspacePath, ".agente", "mcp.json");
}

export async function readMcpConfig(configPath: string): Promise<McpConfig> {
  const raw = await readFile(configPath, "utf8");
  return McpConfigSchema.parse(JSON.parse(raw));
}

/**
 * Conecta con cada servidor definido en `.agente/mcp.json` vía stdio.
 * ponytail: `command`/`args` deben venir del propio `mcp.json` ya resueltos
 * a rutas absolutas (p.ej. la ruta absoluta a `node.exe`, nunca `npx` sin
 * `shell: true`) — Windows no resuelve shims `.cmd` sin una shell real, y
 * este cliente nunca activa `shell: true` para no reabrir la puerta a
 * inyección de comandos vía config.
 */
export async function loadMcpConnections(configPath: string): Promise<McpConnection[]> {
  const config = await readMcpConfig(configPath);

  const connections: McpConnection[] = [];
  for (const [name, serverConfig] of Object.entries(config.mcpServers)) {
    const transport = new StdioClientTransport({
      command: serverConfig.command,
      args: serverConfig.args,
      ...(serverConfig.env !== undefined ? { env: serverConfig.env } : {})
    });
    const client = new Client({ name: `agentev4-${name}`, version: "0.0.0" });
    await client.connect(transport);
    connections.push({ name, client, close: () => client.close() });
  }
  return connections;
}

export async function closeMcpConnections(connections: McpConnection[]): Promise<void> {
  await Promise.all(connections.map((connection) => connection.close()));
}
