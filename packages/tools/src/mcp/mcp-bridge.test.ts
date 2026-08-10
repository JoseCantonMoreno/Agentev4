import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mcpConfigPath, readMcpConfig } from "./mcp-bridge.js";

// ponytail: sin test de spawn real (necesitaría un binario de servidor MCP
// de verdad); esta suite cubre el contrato que sí es responsabilidad de
// Fase 5 — parsear y validar `.agente/mcp.json` antes de intentar conectar.
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
