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

export const ProviderSettingsInputSchema = z.object({
  provider: LlmProviderNameSchema,
  model: z.string().trim().min(1, "El modelo es obligatorio."),
  baseUrl: z
    .string()
    .trim()
    .default("")
    .refine(
      (value) => value === "" || z.string().url().safeParse(value).success,
      "La URL base no es válida."
    ),
  apiKey: z.string().optional()
});
export type ProviderSettingsInput = z.infer<typeof ProviderSettingsInputSchema>;

export const SavedProviderSettingsSchema = z.object({
  config: z.object({
    provider: LlmProviderNameSchema,
    model: z.string().min(1),
    baseUrl: z.string().url().optional()
  }),
  hasApiKey: z.boolean()
});
export type SavedProviderSettings = z.infer<typeof SavedProviderSettingsSchema>;
