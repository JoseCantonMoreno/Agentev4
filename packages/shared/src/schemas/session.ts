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

export const SessionConfigSchema = z.object({
  id: z.string(),
  name: z.string(),
  workspacePath: z.string(),
  mode: AgentModeSchema,
  permissionMode: PermissionModeSchema,
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date()
});
export type SessionConfig = z.infer<typeof SessionConfigSchema>;
