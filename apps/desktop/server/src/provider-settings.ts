import type { KeyStore } from "@agentev4/core";
import {
  type LlmProviderName,
  ProviderSettingsInputSchema,
  SavedProviderSettingsSchema,
  type SavedProviderSettings
} from "@agentev4/shared";

const REMOTE_PROVIDERS = new Set<LlmProviderName>([
  "anthropic",
  "openai",
  "gemini",
  "openrouter",
  "groq"
]);

export function saveProviderSettings(keyStore: KeyStore, input: unknown): SavedProviderSettings {
  const parsed = ProviderSettingsInputSchema.parse(input);
  const apiKey = parsed.apiKey?.trim();
  const hasExistingKey = keyStore.has(parsed.provider);

  if (REMOTE_PROVIDERS.has(parsed.provider) && !apiKey && !hasExistingKey) {
    throw new Error("La API key es obligatoria para este proveedor.");
  }

  const config = {
    provider: parsed.provider,
    model: parsed.model,
    ...(parsed.baseUrl === "" ? {} : { baseUrl: parsed.baseUrl })
  };

  if (apiKey) keyStore.set(parsed.provider, apiKey);

  return SavedProviderSettingsSchema.parse({
    config,
    hasApiKey: Boolean(apiKey) || hasExistingKey
  });
}
