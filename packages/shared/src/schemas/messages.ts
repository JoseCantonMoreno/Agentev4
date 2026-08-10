import { z } from "zod";

export const AgentRoleSchema = z.enum(["system", "user", "assistant", "tool"]);
export type AgentRole = z.infer<typeof AgentRoleSchema>;

export const EffortLevelSchema = z.enum(["low", "medium", "high", "max"]);
export type EffortLevel = z.infer<typeof EffortLevelSchema>;

export const AgentModeSchema = z.enum(["assistant", "agent", "plan"]);
export type AgentMode = z.infer<typeof AgentModeSchema>;

export const StopReasonSchema = z.enum(["tool_use", "end_turn", "max_tokens"]);
export type StopReason = z.infer<typeof StopReasonSchema>;

export const AgentMessageSchema = z.object({
  id: z.string(),
  role: AgentRoleSchema,
  content: z.string(),
  toolCallId: z.string().optional(),
  createdAt: z.coerce.date()
});
export type AgentMessage = z.infer<typeof AgentMessageSchema>;

export const LoopGovernanceSchema = z.object({
  maxTurns: z.number().int().positive(),
  maxBudgetUsd: z.number().positive(),
  effortLevel: EffortLevelSchema
});
export type LoopGovernance = z.infer<typeof LoopGovernanceSchema>;
