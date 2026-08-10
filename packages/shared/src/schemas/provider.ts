import { z } from "zod";

export const LlmProviderNameSchema = z.enum([
  "openai",
  "anthropic",
  "gemini",
  "ollama",
  "openrouter",
  "groq"
]);
export type LlmProviderName = z.infer<typeof LlmProviderNameSchema>;

export const LlmProviderConfigSchema = z.object({
  provider: LlmProviderNameSchema,
  model: z.string(),
  apiKey: z.string().optional(),
  baseUrl: z.string().url().optional()
});
export type LlmProviderConfig = z.infer<typeof LlmProviderConfigSchema>;
