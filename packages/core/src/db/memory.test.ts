import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type DatabaseHandle, openDatabase } from "./client.js";
import { SemanticMemory } from "./memory.js";
import { SessionManager } from "./session-manager.js";

describe("SemanticMemory", () => {
  let handle: DatabaseHandle;
  let memory: SemanticMemory;
  let sessions: SessionManager;

  beforeEach(() => {
    handle = openDatabase(":memory:");
    memory = new SemanticMemory(handle.db);
    sessions = new SessionManager(handle.db);
  });

  afterEach(() => {
    handle.close();
  });

  it("devuelve los chunks más similares ordenados por score descendente", () => {
    memory.addChunk("gato", [1, 0, 0]);
    memory.addChunk("perro", [0.9, 0.1, 0]);
    memory.addChunk("coche", [0, 0, 1]);

    const results = memory.semanticSearch([1, 0, 0], 2);

    expect(results).toHaveLength(2);
    expect(results[0]?.content).toBe("gato");
    expect(results[1]?.content).toBe("perro");
    expect(results[0]?.score).toBeGreaterThan(results[1]?.score ?? 0);
  });

  it("filtra por sessionId cuando se indica", () => {
    const sessionA = sessions.createSession({ name: "A", workspacePath: "/ws", mode: "agent", permissionMode: "default" });
    const sessionB = sessions.createSession({ name: "B", workspacePath: "/ws", mode: "agent", permissionMode: "default" });

    memory.addChunk("de la sesión A", [1, 0], sessionA.id);
    memory.addChunk("de la sesión B", [1, 0], sessionB.id);

    const results = memory.semanticSearch([1, 0], 5, sessionA.id);

    expect(results).toHaveLength(1);
    expect(results[0]?.content).toBe("de la sesión A");
  });
});
