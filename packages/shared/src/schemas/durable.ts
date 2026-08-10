import { z } from "zod";
import { AgentMessageSchema } from "./messages.js";
import { ToolCallSchema, ToolResultSchema } from "./tools.js";

export const DurableCheckpointSchema = z.object({
  turnsUsed: z.number().int().nonnegative(),
  messages: z.array(AgentMessageSchema)
});
export type DurableCheckpoint = z.infer<typeof DurableCheckpointSchema>;

/**
 * Entrada del log durable append-only (Fase 8). Sin campo de secuencia
 * explícito: el orden de líneas del propio JSONL ya es el orden real, y
 * duplicarlo en el payload no añade nada verificable.
 */
export const DurableLogEntrySchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("message"), message: AgentMessageSchema }),
  z.object({ type: z.literal("tool_call"), call: ToolCallSchema }),
  z.object({ type: z.literal("tool_result"), result: ToolResultSchema }),
  z.object({ type: z.literal("checkpoint"), checkpoint: DurableCheckpointSchema }),
  z.object({ type: z.literal("hitl_pause"), reason: z.string() })
]);
export type DurableLogEntry = z.infer<typeof DurableLogEntrySchema>;
