import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  workspacePath: text("workspace_path").notNull(),
  mode: text("mode").notNull(),
  permissionMode: text("permission_mode").notNull(),
  status: text("status").notNull().default("active"),
  parentSessionId: text("parent_session_id"),
  tokensUsed: integer("tokens_used").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull()
});

export const messages = sqliteTable(
  "messages",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id),
    role: text("role").notNull(),
    content: text("content").notNull(),
    toolCallId: text("tool_call_id"),
    orderIndex: integer("order_index").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull()
  },
  (table) => [index("messages_session_idx").on(table.sessionId, table.orderIndex)]
);

export const toolExecutions = sqliteTable(
  "tool_executions",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id),
    toolCallId: text("tool_call_id").notNull(),
    toolName: text("tool_name").notNull(),
    input: text("input").notNull(),
    output: text("output").notNull(),
    isError: integer("is_error", { mode: "boolean" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull()
  },
  (table) => [index("tool_executions_session_idx").on(table.sessionId)]
);

// ponytail: embedding se guarda como JSON de number[] en TEXT (sin extension
// vectorial nativa); la busqueda semantica hace un escaneo con similitud
// coseno en JS (ver memory.ts) -- sube a sqlite-vec o un vector DB dedicado
// si el volumen de memoria crece lo suficiente como para que el escaneo
// lineal sea un cuello de botella real.
export const memoryChunks = sqliteTable(
  "memory_chunks",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id").references(() => sessions.id),
    content: text("content").notNull(),
    embedding: text("embedding").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull()
  },
  (table) => [index("memory_chunks_session_idx").on(table.sessionId)]
);
