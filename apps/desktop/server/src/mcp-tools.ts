import { stat } from "node:fs/promises";
import {
  closeMcpConnections,
  createMcpToolRegistry,
  createStaticToolRegistry,
  loadMcpConnections,
  mcpConfigPath,
  type McpConnection,
  type ToolRegistry
} from "@agentev4/tools";

export interface McpBootstrap {
  registry: ToolRegistry;
  connections: McpConnection[];
}

export { closeMcpConnections };

/**
 * Detecta `.agente/mcp.json` en el workspace y, si existe, conecta con cada
 * servidor MCP declarado y fusiona sus tools con el registro estático
 * (Fase 5). Nunca lanza: un `mcp.json` ausente, inválido, o un servidor que
 * no arranca degradan a solo-tools-nativas con un aviso en stderr, en vez de
 * tumbar el arranque del workspace entero -- las tools MCP son un extra, no
 * un requisito duro como Docker.
 */
export async function connectConfiguredMcpServers(workspacePath: string): Promise<McpBootstrap> {
  const configPath = mcpConfigPath(workspacePath);
  const staticRegistry = createStaticToolRegistry();

  try {
    await stat(configPath);
  } catch {
    return { registry: staticRegistry, connections: [] };
  }

  try {
    const connections = await loadMcpConnections(configPath);
    const mcpRegistry = await createMcpToolRegistry(connections);
    return { registry: { ...staticRegistry, ...mcpRegistry }, connections };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[agent-server] no se pudo conectar con "${configPath}": ${message}\n`);
    return { registry: staticRegistry, connections: [] };
  }
}
