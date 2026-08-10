import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionCheckpointSave } from "@agentev4/tools";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type DatabaseHandle, openDatabase } from "./client.js";
import { SessionManager, SessionNotFoundError } from "./session-manager.js";

describe("SessionManager", () => {
  let workspacePath: string;
  let handle: DatabaseHandle;
  let manager: SessionManager;

  beforeEach(async () => {
    workspacePath = await mkdtemp(join(tmpdir(), "agentev4-sessions-"));
    handle = openDatabase(":memory:");
    manager = new SessionManager(handle.db);
  });

  afterEach(async () => {
    handle.close();
    await rm(workspacePath, { recursive: true, force: true });
  });

  it("crea, lee y lista sesiones", () => {
    const created = manager.createSession({
      name: "Sesión 1",
      workspacePath,
      mode: "agent",
      permissionMode: "default"
    });

    expect(manager.getSession(created.id)).toEqual(created);
    expect(manager.listSessions()).toEqual([created]);
    expect(created.status).toBe("active");
    expect(created.tokensUsed).toBe(0);
  });

  it("renombra, pausa y reanuda una sesión", () => {
    const created = manager.createSession({ name: "A", workspacePath, mode: "agent", permissionMode: "default" });

    const renamed = manager.renameSession(created.id, "B");
    expect(renamed.name).toBe("B");

    const paused = manager.pauseSession(created.id);
    expect(paused.status).toBe("paused");

    const resumed = manager.resumeSession(created.id);
    expect(resumed.status).toBe("active");
  });

  it("lanza SessionNotFoundError sobre una sesión inexistente", () => {
    expect(() => manager.renameSession("no-existe", "x")).toThrow(SessionNotFoundError);
  });

  it("elimina una sesión junto con su historial de mensajes", () => {
    const created = manager.createSession({ name: "A", workspacePath, mode: "agent", permissionMode: "default" });
    manager.appendMessage(created.id, { role: "user", content: "hola" });

    manager.deleteSession(created.id);

    expect(manager.getSession(created.id)).toBeUndefined();
    expect(manager.listSessions()).toEqual([]);
    expect(() => manager.deleteSession(created.id)).toThrow(SessionNotFoundError);
  });

  it("acumula historial de mensajes en orden y actualiza updatedAt", () => {
    const created = manager.createSession({ name: "A", workspacePath, mode: "agent", permissionMode: "default" });

    manager.appendMessage(created.id, { role: "user", content: "hola" });
    manager.appendMessage(created.id, { role: "assistant", content: "hola de vuelta" });

    const history = manager.listMessages(created.id);
    expect(history.map((m) => m.content)).toEqual(["hola", "hola de vuelta"]);

    const updated = manager.getSession(created.id);
    expect(updated?.updatedAt.getTime()).toBeGreaterThanOrEqual(created.updatedAt.getTime());
  });

  it("registra ejecuciones de tools", () => {
    const created = manager.createSession({ name: "A", workspacePath, mode: "agent", permissionMode: "default" });

    manager.recordToolExecution(
      created.id,
      { id: "call_1", name: "FileSystem_Read", input: { path: "a.ts" } },
      { toolCallId: "call_1", output: "contenido", isError: false }
    );

    // No hay getter público de tool_executions todavía (no lo exige el DoD de Fase 6);
    // basta con que no lance y que el token accounting siga funcionando en la misma sesión.
    const withTokens = manager.addTokensUsed(created.id, 42);
    expect(withTokens.tokensUsed).toBe(42);
  });

  it("acumula tokens con addTokensUsed", () => {
    const created = manager.createSession({ name: "A", workspacePath, mode: "agent", permissionMode: "default" });
    manager.addTokensUsed(created.id, 100);
    const after = manager.addTokensUsed(created.id, 50);
    expect(after.tokensUsed).toBe(150);
  });

  it("clona una sesión (branching) copiando el historial completo", () => {
    const original = manager.createSession({ name: "Original", workspacePath, mode: "agent", permissionMode: "default" });
    manager.appendMessage(original.id, { role: "user", content: "primer mensaje" });
    manager.appendMessage(original.id, { role: "assistant", content: "respuesta" });

    const clone = manager.cloneSession(original.id, "Rama alternativa");

    expect(clone.id).not.toBe(original.id);
    expect(clone.parentSessionId).toBe(original.id);
    expect(clone.name).toBe("Rama alternativa");
    expect(manager.listMessages(clone.id).map((m) => m.content)).toEqual(["primer mensaje", "respuesta"]);

    // Independencia: seguir escribiendo en la rama no afecta al original.
    manager.appendMessage(clone.id, { role: "user", content: "solo en la rama" });
    expect(manager.listMessages(original.id)).toHaveLength(2);
    expect(manager.listMessages(clone.id)).toHaveLength(3);
  });

  it("exporta a JSON e importa de vuelta como una sesión nueva e independiente", () => {
    const original = manager.createSession({ name: "Exportable", workspacePath, mode: "agent", permissionMode: "default" });
    manager.appendMessage(original.id, { role: "user", content: "contenido a exportar" });
    manager.addTokensUsed(original.id, 77);

    const exported = manager.exportSession(original.id, "json");
    const imported = manager.importSession(exported);

    expect(imported.id).not.toBe(original.id);
    expect(imported.name).toBe("Exportable");
    expect(imported.tokensUsed).toBe(77);
    expect(manager.listMessages(imported.id).map((m) => m.content)).toEqual(["contenido a exportar"]);
  });

  it("exporta a Markdown incluyendo nombre, workspace y mensajes", () => {
    const original = manager.createSession({ name: "MD", workspacePath, mode: "agent", permissionMode: "default" });
    manager.appendMessage(original.id, { role: "user", content: "hola markdown" });

    const md = manager.exportSession(original.id, "markdown");
    expect(md).toContain("# MD");
    expect(md).toContain("hola markdown");
  });

  it("lista y restaura checkpoints delegando en @agentev4/tools", async () => {
    const created = manager.createSession({ name: "Checkpoints", workspacePath, mode: "agent", permissionMode: "default" });

    expect(await manager.listCheckpoints(created.id)).toEqual([]);

    await SessionCheckpointSave.handler({
      workspacePath,
      sessionId: created.id,
      checkpointId: "cp1",
      snapshot: { turnsUsed: 3 }
    });

    expect(await manager.listCheckpoints(created.id)).toEqual(["cp1"]);
    expect(await manager.restoreCheckpoint(created.id, "cp1")).toEqual({ turnsUsed: 3 });
  });
});
