import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { switchWorkspace, type WorkspaceState } from "./workspace.js";

const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function createWorkspace(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "agentev4-workspace-"));
  cleanup.push(directory);
  return directory;
}

describe("switchWorkspace", () => {
  it("crea .agente y publica el estado solo después de abrir SQLite", async () => {
    const directory = await createWorkspace();
    const state: WorkspaceState = {};

    const result = await switchWorkspace(state, directory);

    expect(result).toEqual({ workspacePath: directory, sessions: [] });
    expect(state.workspacePath).toBe(directory);
    expect(state.sessionManager?.listSessions()).toEqual([]);
    await expect(access(join(directory, ".agente", "sessions.db"))).resolves.toBeUndefined();
    state.dbHandle?.close();
  });

  it("sustituye el estado activo por un workspace válido", async () => {
    const firstDirectory = await createWorkspace();
    const secondDirectory = await createWorkspace();
    const state: WorkspaceState = {};
    await switchWorkspace(state, firstDirectory);
    const originalManager = state.sessionManager;

    const result = await switchWorkspace(state, secondDirectory);

    expect(result).toEqual({ workspacePath: secondDirectory, sessions: [] });
    expect(state.workspacePath).toBe(secondDirectory);
    expect(state.sessionManager).not.toBe(originalManager);
    expect(state.sessionManager?.listSessions()).toEqual([]);
    state.dbHandle?.close();
  });

  it("conserva utilizable el workspace activo cuando falla el reemplazo", async () => {
    const directory = await createWorkspace();
    const invalidPath = join(directory, "not-a-directory.txt");
    await writeFile(invalidPath, "file", "utf8");
    const state: WorkspaceState = {};
    await switchWorkspace(state, directory);
    const originalManager = state.sessionManager;

    await expect(switchWorkspace(state, invalidPath)).rejects.toThrow("no es una carpeta");

    expect(state.workspacePath).toBe(directory);
    expect(state.sessionManager).toBe(originalManager);
    const session = state.sessionManager?.createSession({
      name: "Sigue activa",
      workspacePath: directory,
      mode: "assistant",
      permissionMode: "default"
    });
    expect(state.sessionManager?.getSession(session?.id ?? "")).toEqual(session);
    state.dbHandle?.close();
  });
});
