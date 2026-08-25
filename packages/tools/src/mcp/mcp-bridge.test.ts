import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { executeRegisteredTool } from "../registry.js";
import {
  closeMcpConnections,
  createMcpToolRegistry,
  loadMcpConnections,
  mcpConfigPath,
  readMcpConfig,
  type McpConnection
} from "./mcp-bridge.js";

const FIXTURE_SERVER_PATH = fileURLToPath(new URL("./fixture-server.mjs", import.meta.url));

describe("readMcpConfig", () => {
  let workspacePath: string;

  beforeEach(async () => {
    workspacePath = await mkdtemp(join(tmpdir(), "agentev4-mcp-"));
    await mkdir(join(workspacePath, ".agente"), { recursive: true });
  });

  afterEach(async () => {
    await rm(workspacePath, { recursive: true, force: true });
  });

  it("parsea un mcp.json válido con un servidor stdio", async () => {
    const configPath = mcpConfigPath(workspacePath);
    await writeFile(
      configPath,
      JSON.stringify({
        mcpServers: {
          filesystem: { command: "C:\\Program Files\\nodejs\\node.exe", args: ["server.js"] }
        }
      }),
      "utf8"
    );

    const config = await readMcpConfig(configPath);
    expect(config.mcpServers.filesystem?.command).toBe("C:\\Program Files\\nodejs\\node.exe");
    expect(config.mcpServers.filesystem?.args).toEqual(["server.js"]);
  });

  it("rechaza un mcp.json sin `command`", async () => {
    const configPath = mcpConfigPath(workspacePath);
    await writeFile(configPath, JSON.stringify({ mcpServers: { bad: { args: [] } } }), "utf8");

    await expect(readMcpConfig(configPath)).rejects.toThrow();
  });
});

/**
 * Spawn real por stdio del fixture MCP (`fixture-server.mjs`), sin mocks del
 * SDK ni del transporte -- mismo criterio que el resto del repo (ver Docker
 * efímero, `db/concurrency-worker.mjs`). Cubre el camino de `loadMcpConnections`
 * que antes no tenía ningún test (el spawn en sí).
 */
describe("loadMcpConnections + createMcpToolRegistry (spawn real por stdio)", () => {
  let workspacePath: string;
  let connections: McpConnection[];

  beforeEach(async () => {
    workspacePath = await mkdtemp(join(tmpdir(), "agentev4-mcp-live-"));
    await mkdir(join(workspacePath, ".agente"), { recursive: true });
    await writeFile(
      mcpConfigPath(workspacePath),
      JSON.stringify({
        mcpServers: {
          fixture: { command: process.execPath, args: [FIXTURE_SERVER_PATH] }
        }
      }),
      "utf8"
    );
    connections = await loadMcpConnections(mcpConfigPath(workspacePath));
  });

  afterEach(async () => {
    await closeMcpConnections(connections);
    await rm(workspacePath, { recursive: true, force: true });
  });

  it("conecta de verdad con el servidor MCP y expone sus tools vía listTools()", async () => {
    expect(connections).toHaveLength(1);
    expect(connections[0]?.name).toBe("fixture");

    const { tools } = await connections[0]!.client.listTools();

    expect(tools.map((tool) => tool.name).sort()).toEqual(["Boom", "Echo"]);
  });

  it("createMcpToolRegistry produce un ToolRegistry ejecutable con las tools remotas", async () => {
    const registry = await createMcpToolRegistry(connections);

    expect(Object.keys(registry)).toEqual(["fixture__Echo", "fixture__Boom"]);

    const result = await executeRegisteredTool(registry, {
      id: "c1",
      name: "fixture__Echo",
      input: { text: "hola desde el registry" }
    });

    expect(result.isError).toBe(false);
    expect(result.output).toBe("hola desde el registry");
  });

  it("propaga isError=true cuando la tool MCP remota falla", async () => {
    const registry = await createMcpToolRegistry(connections);

    const result = await executeRegisteredTool(registry, {
      id: "c1",
      name: "fixture__Boom",
      input: { text: "x" }
    });

    expect(result.isError).toBe(true);
    expect(result.output).toContain("kaboom");
  });
});
