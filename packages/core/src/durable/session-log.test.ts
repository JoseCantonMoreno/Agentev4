import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DurableLogEntry } from "@agentev4/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appendLogEntry, latestCheckpoint, replayLog } from "./session-log.js";

describe("session-log", () => {
  let dir: string;
  let logPath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "agentev4-durable-log-"));
    logPath = join(dir, "nested", "session.jsonl");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("replayLog devuelve [] si el archivo no existe todavía", async () => {
    expect(await replayLog(logPath)).toEqual([]);
  });

  it("append + replay preserva el orden exacto de las entradas", async () => {
    const entries: DurableLogEntry[] = [
      { type: "message", message: { id: "1", role: "user", content: "hola", createdAt: new Date() } },
      { type: "tool_call", call: { id: "t1", name: "noop", input: {} } },
      { type: "tool_result", result: { toolCallId: "t1", output: "ok", isError: false } }
    ];
    for (const entry of entries) await appendLogEntry(logPath, entry);

    const replayed = await replayLog(logPath);
    expect(replayed).toHaveLength(3);
    expect(replayed[0]?.type).toBe("message");
    expect(replayed[1]?.type).toBe("tool_call");
    expect(replayed[2]?.type).toBe("tool_result");
  });

  it("latestCheckpoint encuentra el checkpoint más reciente, ignorando entradas posteriores", async () => {
    await appendLogEntry(logPath, { type: "checkpoint", checkpoint: { turnsUsed: 3, messages: [] } });
    await appendLogEntry(logPath, {
      type: "message",
      message: { id: "x", role: "assistant", content: "turno 4 sin checkpoint", createdAt: new Date() }
    });

    const entries = await replayLog(logPath);
    const checkpoint = latestCheckpoint(entries);
    expect(checkpoint?.checkpoint.turnsUsed).toBe(3);
  });

  it("Fase 10 DoD: un campo ajeno (ej. apiKey) adjuntado a una entrada nunca llega al JSONL en disco", async () => {
    const contaminated = {
      type: "hitl_pause",
      reason: "esperando confirmación",
      apiKey: "sk-ant-esto-no-deberia-persistirse"
    } as unknown as DurableLogEntry;

    await appendLogEntry(logPath, contaminated);

    const raw = await readFile(logPath, "utf8");
    expect(raw).not.toContain("sk-ant-esto-no-deberia-persistirse");

    const [replayed] = await replayLog(logPath);
    expect(replayed).toEqual({ type: "hitl_pause", reason: "esperando confirmación" });
  });

  it("latestCheckpoint devuelve undefined si no hay ningún checkpoint", async () => {
    await appendLogEntry(logPath, {
      type: "message",
      message: { id: "1", role: "user", content: "hola", createdAt: new Date() }
    });
    expect(latestCheckpoint(await replayLog(logPath))).toBeUndefined();
  });
});
