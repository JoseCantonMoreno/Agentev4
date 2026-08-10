// ponytail: JS plano (no TS) a propósito -- es un harness de test desechable
// que corre en un hilo aparte via node:worker_threads; añadir un loader TS
// solo para este fichero de 20 líneas sería una dependencia nueva sin
// beneficio real (no forma parte de la superficie de la aplicación).
import Database from "better-sqlite3";
import { parentPort, workerData } from "node:worker_threads";

const { dbPath, sessionId, workerId, rowCount } = workerData;

const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("busy_timeout = 5000");

const insert = db.prepare(
  "INSERT INTO messages (id, session_id, role, content, tool_call_id, order_index, created_at) VALUES (?, ?, 'user', ?, NULL, ?, ?)"
);

const insertBatch = db.transaction((rows) => {
  for (const row of rows) insert.run(...row);
});

const rows = Array.from({ length: rowCount }, (_, i) => [
  `${workerId}-${i}`,
  sessionId,
  `mensaje ${workerId}-${i}`,
  i,
  Date.now()
]);

insertBatch(rows);
db.close();
parentPort?.postMessage("done");
