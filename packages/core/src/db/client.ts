import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import * as schema from "./schema.js";

// ponytail: bootstrap de esquema via CREATE TABLE IF NOT EXISTS en vez de
// drizzle-kit generate/migrate — no hay usuarios existentes cuyo esquema
// migrar todavía. Debe mantenerse en sync manual con schema.ts; el upgrade
// path es introducir drizzle-kit en cuanto el esquema necesite versionado
// real entre instalaciones.
const BOOTSTRAP_SQL = `
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  workspace_path TEXT NOT NULL,
  mode TEXT NOT NULL,
  permission_mode TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  parent_session_id TEXT,
  tokens_used INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  tool_call_id TEXT,
  order_index INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS messages_session_idx ON messages(session_id, order_index);

CREATE TABLE IF NOT EXISTS tool_executions (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  tool_call_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  input TEXT NOT NULL,
  output TEXT NOT NULL,
  is_error INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS tool_executions_session_idx ON tool_executions(session_id);

CREATE TABLE IF NOT EXISTS memory_chunks (
  id TEXT PRIMARY KEY,
  session_id TEXT REFERENCES sessions(id),
  content TEXT NOT NULL,
  embedding TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS memory_chunks_session_idx ON memory_chunks(session_id);
`;

export type AppDatabase = ReturnType<typeof drizzle<typeof schema>>;

export interface DatabaseHandle {
  db: AppDatabase;
  sqlite: Database.Database;
  close: () => void;
}

/**
 * Abre (o crea) la base SQLite de sesiones. Activa WAL + busy_timeout antes
 * de cualquier otra operación para que conexiones concurrentes (varias
 * pestañas/procesos tocando la misma sesión) esperen el lock en vez de
 * fallar con SQLITE_BUSY, tal y como exige el DoD de la Fase 6.
 */
export function openDatabase(dbPath: string): DatabaseHandle {
  if (dbPath !== ":memory:") {
    mkdirSync(dirname(dbPath), { recursive: true });
  }

  const sqlite = new Database(dbPath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("busy_timeout = 5000");
  sqlite.exec(BOOTSTRAP_SQL);

  const db = drizzle(sqlite, { schema });
  return { db, sqlite, close: () => sqlite.close() };
}
