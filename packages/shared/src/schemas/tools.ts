import { z } from "zod";

export const ToolCallSchema = z.object({
  id: z.string(),
  name: z.string(),
  input: z.record(z.unknown())
});
export type ToolCall = z.infer<typeof ToolCallSchema>;

export const ToolResultSchema = z.object({
  toolCallId: z.string(),
  output: z.unknown(),
  isError: z.boolean().default(false)
});
export type ToolResult = z.infer<typeof ToolResultSchema>;
