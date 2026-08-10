import { z } from "zod";
import { ToolCallSchema } from "./tools.js";

export const AgentThoughtEventSchema = z.object({
  type: z.literal("agent:thought"),
  sessionId: z.string(),
  content: z.string()
});
export type AgentThoughtEvent = z.infer<typeof AgentThoughtEventSchema>;

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
  AgentThoughtEventSchema,
  AgentToolCallEventSchema,
  AgentContextUpdateEventSchema,
  AgentPermissionRequestEventSchema
]);
export type AgentIpcEvent = z.infer<typeof AgentIpcEventSchema>;
