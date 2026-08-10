import Database from "better-sqlite3";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase } from "./client.js";
import { SessionManager } from "./session-manager.js";

const WORKER_PATH = fileURLToPath(new URL("./concurrency-worker.mjs", import.meta.url));

interface WorkerData {
  dbPath: string;
  sessionId: string;
  workerId: string;
  rowCount: number;
}

function runWorker(workerData: WorkerData): Promise<void> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(WORKER_PATH, { workerData });
    worker.once("message", () => resolve());
    worker.once("error", reject);
    worker.once("exit", (code) => {
      if (code !== 0) reject(new Error(`concurrency-worker.mjs salió con código ${code}`));
    });
  });
}

describe("Escritura concurrente en SQLite (DoD Fase 6)", () => {
  let dir: string;
  let dbPath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "agentev4-concurrency-"));
    dbPath = join(dir, "sessions.db");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("dos hilos con conexiones independientes escribiendo a la vez no corrompen la DB", async () => {
    const handle = openDatabase(dbPath);
    const manager = new SessionManager(handle.db);
    const session = manager.createSession({
      name: "concurrencia",
      workspacePath: dir,
      mode: "agent",
      permissionMode: "default"
    });
    handle.close();

    const rowsPerWorker = 200;
    await Promise.all([
      runWorker({ dbPath, sessionId: session.id, workerId: "w1", rowCount: rowsPerWorker }),
      runWorker({ dbPath, sessionId: session.id, workerId: "w2", rowCount: rowsPerWorker })
    ]);

    const verify = new Database(dbPath);
    const integrity = verify.pragma("integrity_check");
    const row = verify.prepare("SELECT COUNT(*) as count FROM messages WHERE session_id = ?").get(session.id) as
      | { count: number }
      | undefined;
    verify.close();

    expect(integrity).toEqual([{ integrity_check: "ok" }]);
    expect(row?.count).toBe(rowsPerWorker * 2);
  }, 30000);
});
