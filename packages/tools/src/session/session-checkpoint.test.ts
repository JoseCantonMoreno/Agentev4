import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SessionCheckpointLoad, SessionCheckpointSave } from "./session-checkpoint.js";

describe("Session_Checkpoint", () => {
  let workspacePath: string;

  beforeEach(async () => {
    workspacePath = await mkdtemp(join(tmpdir(), "agentev4-checkpoint-"));
  });

  afterEach(async () => {
    await rm(workspacePath, { recursive: true, force: true });
  });

  it("guarda y recupera un snapshot bajo .agente/checkpoints/<sessionId>/<checkpointId>.json", async () => {
    const snapshot = { turnsUsed: 3, goals: ["a", "b"] };
    await SessionCheckpointSave.handler({ workspacePath, sessionId: "s1", checkpointId: "cp1", snapshot });

    const loaded = await SessionCheckpointLoad.handler({ workspacePath, sessionId: "s1", checkpointId: "cp1" });
    expect(loaded).toEqual(snapshot);
  });

  it("falla explícitamente al cargar un checkpoint inexistente", async () => {
    await expect(
      SessionCheckpointLoad.handler({ workspacePath, sessionId: "s1", checkpointId: "no-existe" })
    ).rejects.toThrow();
  });
});
