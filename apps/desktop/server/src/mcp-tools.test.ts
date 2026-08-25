import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { closeMcpConnections } from "@agentev4/tools";
import { afterEach, describe, expect, it } from "vitest";
import { connectConfiguredMcpServers } from "./mcp-tools.js";

const FIXTURE_SERVER_PATH = fileURLToPath(
  new URL("../../../../packages/tools/src/mcp/fixture-server.mjs", import.meta.url)
);

const cleanup: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((task) => task()));
});

async function createWorkspace(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "agentev4-desktop-mcp-"));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

describe("connectConfiguredMcpServers", () => {
  it("sin .agente/mcp.json, devuelve solo el registro estático y sin conexiones", async () => {
    const workspacePath = await createWorkspace();

    const result = await connectConfiguredMcpServers(workspacePath);

    expect(result.connections).toEqual([]);
    expect(Object.keys(result.registry)).toContain("FileSystem_Read");
    expect(Object.keys(result.registry).some((name) => name.includes("__"))).toBe(false);
  });

  it("con un .agente/mcp.json válido, fusiona las tools MCP reales con las nativas", async () => {
    const workspacePath = await createWorkspace();
    await mkdir(join(workspacePath, ".agente"), { recursive: true });
    await writeFile(
      join(workspacePath, ".agente", "mcp.json"),
      JSON.stringify({ mcpServers: { fixture: { command: process.execPath, args: [FIXTURE_SERVER_PATH] } } }),
      "utf8"
    );

    const result = await connectConfiguredMcpServers(workspacePath);
    cleanup.push(() => closeMcpConnections(result.connections));

    expect(result.connections).toHaveLength(1);
    expect(Object.keys(result.registry)).toContain("FileSystem_Read");
    expect(Object.keys(result.registry)).toContain("fixture__Echo");
  });

  it("un servidor MCP que no arranca degrada a solo tools nativas, sin lanzar", async () => {
    const workspacePath = await createWorkspace();
    await mkdir(join(workspacePath, ".agente"), { recursive: true });
    await writeFile(
      join(workspacePath, ".agente", "mcp.json"),
      JSON.stringify({ mcpServers: { roto: { command: "agentev4-binario-que-no-existe", args: [] } } }),
      "utf8"
    );

    const result = await connectConfiguredMcpServers(workspacePath);

    expect(result.connections).toEqual([]);
    expect(Object.keys(result.registry).some((name) => name.includes("__"))).toBe(false);
  });
});
