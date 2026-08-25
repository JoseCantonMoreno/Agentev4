import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { z } from "zod";
import { defineTool, type ToolRegistry } from "../registry.js";

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

function extractTextOutput(content: Array<{ type: string; text?: string }>): string {
  const text = content
    .filter((item): item is { type: "text"; text: string } => item.type === "text" && typeof item.text === "string")
    .map((item) => item.text)
    .join("\n");
  return text.length > 0 ? text : JSON.stringify(content);
}

/**
 * Convierte las tools de cada `McpConnection` (descubiertas vía `listTools`)
 * en un `ToolRegistry` ejecutable, con el mismo contrato que las tools
 * nativas de la Fase 5 -- así el registro fusionado (estático + MCP) fluye
 * sin distinción especial por `executeRegisteredTool`, el motor de permisos
 * y `toToolDeclarations` hacia el LLM.
 *
 * Nombre de tool = `${servidor}__${tool}` para evitar colisiones entre
 * servidores MCP distintos que expongan tools con el mismo nombre.
 *
 * ponytail: `inputSchema` es un passthrough Zod (`z.record(z.unknown())`),
 * no una conversión real del JSON Schema que declara el servidor MCP --
 * convertir JSON Schema -> Zod con fidelidad total es una librería aparte
 * sin beneficio claro aquí, porque la validación real de todos modos la hace
 * el servidor MCP dentro de `callTool`; esta capa solo necesita dejar pasar
 * el input tal cual.
 */
export async function createMcpToolRegistry(connections: McpConnection[]): Promise<ToolRegistry> {
  const registry: ToolRegistry = {};

  for (const connection of connections) {
    const { tools } = await connection.client.listTools();
    for (const tool of tools) {
      const name = `${connection.name}__${tool.name}`;
      registry[name] = defineTool({
        name,
        description: tool.description ?? `Tool "${tool.name}" del servidor MCP "${connection.name}".`,
        inputSchema: z.record(z.unknown()),
        outputSchema: z.string(),
        handler: async (input) => {
          const result = await connection.client.callTool({ name: tool.name, arguments: input });
          const content = Array.isArray(result.content) ? result.content : [];
          const output = extractTextOutput(content as Array<{ type: string; text?: string }>);
          if (result.isError) throw new Error(output);
          return output;
        }
      });
    }
  }

  return registry;
}
