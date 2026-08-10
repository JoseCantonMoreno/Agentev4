import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "@agentev4/core";
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
  const preparation = {
    defaultMode: "agent" as const,
    defaultPermissionMode: "default" as const,
    listTools: async () => ["FileSystem_Read"]
  };

  it("prepares one test session, its messages and tools before publishing", async () => {
    const directory = await createWorkspace();
    const state: WorkspaceState = {};

    try {
      const result = await switchWorkspace(state, directory, preparation);

      expect(result.workspacePath).toBe(directory);
      expect(result.sessions).toHaveLength(1);
      expect(result.sessions[0]?.name).toBe("Sesi\u00f3n de prueba");
      expect(result.activeSessionId).toBe(result.sessions[0]?.id);
      expect(result.messages).toEqual([]);
      expect(result.tools).toEqual(["FileSystem_Read"]);
    } finally {
      state.dbHandle?.close();
    }
  });

  it("keeps the prior manager and database usable when preparation fails after opening B", async () => {
    const firstDirectory = await createWorkspace();
    const secondDirectory = await createWorkspace();
    const state: WorkspaceState = {};
    try {
      await switchWorkspace(state, firstDirectory, preparation);
      const originalHandle = state.dbHandle;
      const originalManager = state.sessionManager;
      const invalidHandle = openDatabase(join(secondDirectory, ".agente", "sessions.db"));
      invalidHandle.sqlite
        .prepare(
          `INSERT INTO sessions
            (id, name, workspace_path, mode, permission_mode, status, tokens_used, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          "invalid-session",
          "Invalid",
          secondDirectory,
          "invalid-mode",
          "default",
          "active",
          0,
          Date.parse("2026-08-10T10:00:00.000Z"),
          Date.parse("2026-08-10T10:00:00.000Z")
        );
      invalidHandle.close();

      await expect(switchWorkspace(state, secondDirectory, preparation)).rejects.toThrow();

      expect(state.workspacePath).toBe(firstDirectory);
      expect(state.dbHandle).toBe(originalHandle);
      expect(state.sessionManager).toBe(originalManager);
      const preserved = originalManager?.createSession({
        name: "A sigue activa",
        workspacePath: firstDirectory,
        mode: "assistant",
        permissionMode: "default"
      });
      expect(originalManager?.getSession(preserved?.id ?? "")).toEqual(preserved);
    } finally {
      state.dbHandle?.close();
    }
  });

  it("selects sessions by updatedAt, createdAt and id before loading messages", async () => {
    const directory = await createWorkspace();
    const databasePath = join(directory, ".agente", "sessions.db");
    const seedHandle = openDatabase(databasePath);
    const insertSession = seedHandle.sqlite.prepare(
      `INSERT INTO sessions
        (id, name, workspace_path, mode, permission_mode, status, tokens_used, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const updatedAt = Date.parse("2026-08-10T10:00:00.000Z");
    insertSession.run(
      "a",
      "a",
      directory,
      "agent",
      "default",
      "active",
      0,
      Date.parse("2026-08-01T10:00:00.000Z"),
      updatedAt
    );
    for (const id of ["z", "b"]) {
      insertSession.run(
        id,
        id,
        directory,
        "agent",
        "default",
        "active",
        0,
        Date.parse("2026-08-02T10:00:00.000Z"),
        updatedAt
      );
    }
    seedHandle.sqlite
      .prepare(
        `INSERT INTO messages
          (id, session_id, role, content, order_index, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run("message-b", "b", "assistant", "most recent", 0, updatedAt);
    seedHandle.close();

    const state: WorkspaceState = {};
    try {
      const ready = await switchWorkspace(state, directory, preparation);

      expect(ready.sessions.map(({ id }) => id)).toEqual(["b", "z", "a"]);
      expect(ready.activeSessionId).toBe("b");
      expect(ready.messages.map(({ content }) => content)).toEqual(["most recent"]);
    } finally {
      state.dbHandle?.close();
    }
  });

  it("does not duplicate the automatic session when reopening a workspace", async () => {
    const directory = await createWorkspace();
    const state: WorkspaceState = {};

    try {
      const first = await switchWorkspace(state, directory, preparation);
      const second = await switchWorkspace(state, directory, preparation);

      expect(first.sessions).toHaveLength(1);
      expect(second.sessions).toHaveLength(1);
      expect(second.sessions[0]?.id).toBe(first.sessions[0]?.id);
    } finally {
      state.dbHandle?.close();
    }
  });

  it("crea .agente y publica el estado solo después de abrir SQLite", async () => {
    const directory = await createWorkspace();
    const state: WorkspaceState = {};

    const result = await switchWorkspace(state, directory, preparation);

    expect(result.workspacePath).toBe(directory);
    expect(result.sessions).toHaveLength(1);
    expect(state.workspacePath).toBe(directory);
    expect(state.sessionManager?.listSessions()).toHaveLength(1);
    await expect(access(join(directory, ".agente", "sessions.db"))).resolves.toBeUndefined();
    state.dbHandle?.close();
  });

  it("sustituye el estado activo por un workspace válido", async () => {
    const firstDirectory = await createWorkspace();
    const secondDirectory = await createWorkspace();
    const state: WorkspaceState = {};
    await switchWorkspace(state, firstDirectory, preparation);
    const originalManager = state.sessionManager;

    const result = await switchWorkspace(state, secondDirectory, preparation);

    expect(result.workspacePath).toBe(secondDirectory);
    expect(result.sessions).toHaveLength(1);
    expect(state.workspacePath).toBe(secondDirectory);
    expect(state.sessionManager).not.toBe(originalManager);
    expect(state.sessionManager?.listSessions()).toHaveLength(1);
    state.dbHandle?.close();
  });

  it("conserva utilizable el workspace activo cuando falla el reemplazo", async () => {
    const directory = await createWorkspace();
    const invalidPath = join(directory, "not-a-directory.txt");
    await writeFile(invalidPath, "file", "utf8");
    const state: WorkspaceState = {};
    await switchWorkspace(state, directory, preparation);
    const originalManager = state.sessionManager;

    await expect(switchWorkspace(state, invalidPath, preparation)).rejects.toThrow(
      "no es una carpeta"
    );

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
