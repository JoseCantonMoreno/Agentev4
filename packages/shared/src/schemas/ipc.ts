import { z } from "zod";
import { ToolCallSchema } from "./tools.js";

/**
 * Fragmento incremental de texto de un turno del asistente en curso.
 * `messageId` identifica el turno (y el intento, si hubo reintento tras un
 * fallo transitorio): cada llamada al modelo genera uno nuevo, así que un
 * `messageId` distinto le indica al consumidor que debe abrir una burbuja
 * nueva en vez de seguir acumulando sobre la anterior.
 */
export const AgentMessageDeltaEventSchema = z.object({
  type: z.literal("agent:message_delta"),
  sessionId: z.string(),
  messageId: z.string(),
  delta: z.string()
});
export type AgentMessageDeltaEvent = z.infer<typeof AgentMessageDeltaEventSchema>;

export const AgentToolCallEventSchema = z.object({
  type: z.literal("agent:tool_call"),
  sessionId: z.string(),
  toolCall: ToolCallSchema
});
export type AgentToolCallEvent = z.infer<typeof AgentToolCallEventSchema>;

export const ContextBreakdownSchema = z.object({
  systemPrompt: z.number().int().nonnegative(),
  rules: z.number().int().nonnegative(),
  tools: z.number().int().nonnegative(),
  history: z.number().int().nonnegative(),
  total: z.number().int().nonnegative()
});
export type ContextBreakdown = z.infer<typeof ContextBreakdownSchema>;

export const AgentContextUpdateEventSchema = z.object({
  type: z.literal("agent:context_update"),
  sessionId: z.string(),
  usedTokens: z.number().int().nonnegative(),
  maxTokens: z.number().int().positive(),
  /** Desglose por componente (Fase 7); opcional para no romper emisores existentes. */
  breakdown: ContextBreakdownSchema.optional()
});
export type AgentContextUpdateEvent = z.infer<typeof AgentContextUpdateEventSchema>;

/**
 * Evento IPC adicional a los 3 mínimos del plan (Fase 11): dispara el modal
 * HITL en la UI. `requestId` identifica la respuesta que el frontend debe
 * devolver vía el método `respondPermission` del agent-server.
 */
export const AgentPermissionRequestEventSchema = z.object({
  type: z.literal("agent:permission_request"),
  sessionId: z.string(),
  requestId: z.string(),
  toolCall: ToolCallSchema
});
export type AgentPermissionRequestEvent = z.infer<typeof AgentPermissionRequestEventSchema>;

export const AgentIpcEventSchema = z.discriminatedUnion("type", [
  AgentMessageDeltaEventSchema,
  AgentToolCallEventSchema,
  AgentContextUpdateEventSchema,
  AgentPermissionRequestEventSchema
]);
export type AgentIpcEvent = z.infer<typeof AgentIpcEventSchema>;
