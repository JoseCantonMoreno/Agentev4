import { z } from "zod";
import { AgentModeSchema } from "./messages.js";

export const PermissionModeSchema = z.enum([
  "default",
  "dontAsk",
  "acceptEdits",
  "plan",
  "bypassPermissions",
  "auto"
]);
export type PermissionMode = z.infer<typeof PermissionModeSchema>;

export const SessionStatusSchema = z.enum(["active", "paused"]);
export type SessionStatus = z.infer<typeof SessionStatusSchema>;

export const SessionConfigSchema = z.object({
  id: z.string(),
  name: z.string(),
  workspacePath: z.string(),
  mode: AgentModeSchema,
  permissionMode: PermissionModeSchema,
  status: SessionStatusSchema.default("active"),
  parentSessionId: z.string().optional(),
  tokensUsed: z.number().int().nonnegative().default(0),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date()
});
export type SessionConfig = z.infer<typeof SessionConfigSchema>;

export const InitWorkspaceInputSchema = z.object({
  workspacePath: z.string().trim().min(1),
  defaultMode: AgentModeSchema,
  defaultPermissionMode: PermissionModeSchema
});
export type InitWorkspaceInput = z.infer<typeof InitWorkspaceInputSchema>;
