import { randomUUID } from "node:crypto";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { AgentMessage, SessionConfig, ToolCall, ToolResult } from "@agentev4/shared";
import { SessionConfigSchema } from "@agentev4/shared";
import { resolveInWorkspace, SessionCheckpointLoad } from "@agentev4/tools";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { AppDatabase } from "./client.js";
import { messages, sessions, toolExecutions } from "./schema.js";

export class SessionNotFoundError extends Error {
  constructor(sessionId: string) {
    super(`Sesión "${sessionId}" no existe.`);
    this.name = "SessionNotFoundError";
  }
}

export interface CreateSessionInput {
  name: string;
  workspacePath: string;
  mode: SessionConfig["mode"];
  permissionMode: SessionConfig["permissionMode"];
}

type SessionRow = typeof sessions.$inferSelect;
type MessageRow = typeof messages.$inferSelect;

function rowToSessionConfig(row: SessionRow): SessionConfig {
  return SessionConfigSchema.parse({
    id: row.id,
    name: row.name,
    workspacePath: row.workspacePath,
    mode: row.mode,
    permissionMode: row.permissionMode,
    status: row.status,
    parentSessionId: row.parentSessionId ?? undefined,
    tokensUsed: row.tokensUsed,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  });
}

function rowToMessage(row: MessageRow): AgentMessage {
  return {
    id: row.id,
    role: row.role as AgentMessage["role"],
    content: row.content,
    toolCallId: row.toolCallId ?? undefined,
    createdAt: row.createdAt
  };
}

const ExportedSessionSchema = z.object({
  session: SessionConfigSchema,
  messages: z.array(z.object({ id: z.string(), role: z.string(), content: z.string(), toolCallId: z.string().optional(), createdAt: z.coerce.date() }))
});

/**
 * CRUD + branching sobre sesiones (Fase 6). Todos los métodos son
 * síncronos a propósito: better-sqlite3 es un driver síncrono (por eso se
 * eligió, evita el pitfall clásico de mezclar await con locks SQLite), así
 * que envolver esto en promesas solo añadiría ruido sin ganar nada real.
 */
export class SessionManager {
  constructor(private readonly db: AppDatabase) {}

  createSession(input: CreateSessionInput): SessionConfig {
    const now = new Date();
    const row: SessionRow = {
      id: randomUUID(),
      name: input.name,
      workspacePath: input.workspacePath,
      mode: input.mode,
      permissionMode: input.permissionMode,
      status: "active",
      parentSessionId: null,
      tokensUsed: 0,
      createdAt: now,
      updatedAt: now
    };
    this.db.insert(sessions).values(row).run();
    return rowToSessionConfig(row);
  }

  getSession(sessionId: string): SessionConfig | undefined {
    const row = this.db.select().from(sessions).where(eq(sessions.id, sessionId)).get();
    return row ? rowToSessionConfig(row) : undefined;
  }

  private requireSessionRow(sessionId: string): SessionRow {
    const row = this.db.select().from(sessions).where(eq(sessions.id, sessionId)).get();
    if (!row) throw new SessionNotFoundError(sessionId);
    return row;
  }

  listSessions(): SessionConfig[] {
    return this.db.select().from(sessions).all().map(rowToSessionConfig);
  }

  renameSession(sessionId: string, name: string): SessionConfig {
    this.requireSessionRow(sessionId);
    const row = this.db
      .update(sessions)
      .set({ name, updatedAt: new Date() })
      .where(eq(sessions.id, sessionId))
      .returning()
      .get();
    return rowToSessionConfig(row);
  }

  pauseSession(sessionId: string): SessionConfig {
    return this.setStatus(sessionId, "paused");
  }

  resumeSession(sessionId: string): SessionConfig {
    return this.setStatus(sessionId, "active");
  }

  private setStatus(sessionId: string, status: SessionConfig["status"]): SessionConfig {
    this.requireSessionRow(sessionId);
    const row = this.db
      .update(sessions)
      .set({ status, updatedAt: new Date() })
      .where(eq(sessions.id, sessionId))
      .returning()
      .get();
    return rowToSessionConfig(row);
  }

  listMessages(sessionId: string): AgentMessage[] {
    return this.db
      .select()
      .from(messages)
      .where(eq(messages.sessionId, sessionId))
      .orderBy(messages.orderIndex)
      .all()
      .map(rowToMessage);
  }

  appendMessage(sessionId: string, message: Omit<AgentMessage, "id" | "createdAt"> & Partial<Pick<AgentMessage, "id" | "createdAt">>): AgentMessage {
    this.requireSessionRow(sessionId);
    const id = message.id ?? randomUUID();
    const createdAt = message.createdAt ?? new Date();

    this.db.transaction((tx) => {
      const countRows = tx
        .select({ count: sql<number>`count(*)` })
        .from(messages)
        .where(eq(messages.sessionId, sessionId))
        .all();
      const count = countRows[0]?.count ?? 0;
      tx
        .insert(messages)
        .values({
          id,
          sessionId,
          role: message.role,
          content: message.content,
          toolCallId: message.toolCallId ?? null,
          orderIndex: count,
          createdAt
        })
        .run();
      tx.update(sessions).set({ updatedAt: new Date() }).where(eq(sessions.id, sessionId)).run();
    });

    return { id, role: message.role, content: message.content, toolCallId: message.toolCallId, createdAt };
  }

  recordToolExecution(sessionId: string, call: ToolCall, result: ToolResult): void {
    this.requireSessionRow(sessionId);
    this.db
      .insert(toolExecutions)
      .values({
        id: randomUUID(),
        sessionId,
        toolCallId: call.id,
        toolName: call.name,
        input: JSON.stringify(call.input),
        output: JSON.stringify(result.output),
        isError: result.isError,
        createdAt: new Date()
      })
      .run();
  }

  addTokensUsed(sessionId: string, delta: number): SessionConfig {
    this.requireSessionRow(sessionId);
    const row = this.db
      .update(sessions)
      .set({ tokensUsed: sql`${sessions.tokensUsed} + ${delta}`, updatedAt: new Date() })
      .where(eq(sessions.id, sessionId))
      .returning()
      .get();
    return rowToSessionConfig(row);
  }

  /** Branching: clona la sesión y todo su historial de mensajes en una sesión nueva e independiente. */
  cloneSession(sessionId: string, newName: string): SessionConfig {
    return this.db.transaction((tx) => {
      const original = tx.select().from(sessions).where(eq(sessions.id, sessionId)).get();
      if (!original) throw new SessionNotFoundError(sessionId);

      const now = new Date();
      const clone: SessionRow = {
        id: randomUUID(),
        name: newName,
        workspacePath: original.workspacePath,
        mode: original.mode,
        permissionMode: original.permissionMode,
        status: "active",
        parentSessionId: original.id,
        tokensUsed: original.tokensUsed,
        createdAt: now,
        updatedAt: now
      };
      tx.insert(sessions).values(clone).run();

      const originalMessages = tx
        .select()
        .from(messages)
        .where(eq(messages.sessionId, sessionId))
        .orderBy(messages.orderIndex)
        .all();
      for (const originalMessage of originalMessages) {
        tx
          .insert(messages)
          .values({ ...originalMessage, id: randomUUID(), sessionId: clone.id })
          .run();
      }

      return rowToSessionConfig(clone);
    });
  }

  exportSession(sessionId: string, format: "json" | "markdown"): string {
    const session = this.getSession(sessionId);
    if (!session) throw new SessionNotFoundError(sessionId);
    const history = this.listMessages(sessionId);

    if (format === "json") {
      return JSON.stringify({ session, messages: history }, null, 2);
    }

    const lines = [`# ${session.name}`, "", `Workspace: ${session.workspacePath}`, ""];
    for (const message of history) {
      lines.push(`## ${message.role} — ${message.createdAt.toISOString()}`, "", message.content, "");
    }
    return lines.join("\n");
  }

  /** Recrea una sesión (con un id nuevo, nunca reutiliza el original) a partir de un export JSON. */
  importSession(exportedJson: string): SessionConfig {
    const parsed = ExportedSessionSchema.parse(JSON.parse(exportedJson));
    const created = this.createSession({
      name: parsed.session.name,
      workspacePath: parsed.session.workspacePath,
      mode: parsed.session.mode,
      permissionMode: parsed.session.permissionMode
    });

    for (const message of parsed.messages) {
      this.appendMessage(created.id, {
        role: message.role as AgentMessage["role"],
        content: message.content,
        toolCallId: message.toolCallId
      });
    }

    return this.addTokensUsed(created.id, parsed.session.tokensUsed);
  }

  async listCheckpoints(sessionId: string): Promise<string[]> {
    const session = this.requireSessionRow(sessionId);
    const dir = resolveInWorkspace(session.workspacePath, join(".agente", "checkpoints", sessionId));
    try {
      const files = await readdir(dir);
      return files.filter((file) => file.endsWith(".json")).map((file) => file.replace(/\.json$/, ""));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }

  async restoreCheckpoint(sessionId: string, checkpointId: string): Promise<Record<string, unknown>> {
    const session = this.requireSessionRow(sessionId);
    return SessionCheckpointLoad.handler({ workspacePath: session.workspacePath, sessionId, checkpointId });
  }
}
