import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogle } from "@ai-sdk/google";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { MastraModelConfig } from "@mastra/core/llm";
import type { LlmProviderConfig } from "@agentev4/shared";

const OPENAI_COMPATIBLE_DEFAULTS = {
  openai: "https://api.openai.com/v1",
  ollama: "http://localhost:11434/v1",
  openrouter: "https://openrouter.ai/api/v1",
  groq: "https://api.groq.com/openai/v1"
} as const;

/**
 * Traduce el contrato agnóstico `LlmProviderConfig` (Fase 1) a un modelo
 * concreto del Vercel AI SDK. Fallos de conexión/reintento/failover se
 * gestionan en Fase 10; aquí solo se resuelve el modelo.
 *
 * ponytail: cast a `MastraModelConfig` porque `@mastra/core` versiona sus
 * tipos de `@ai-sdk/provider` internamente (alias v5/v6/v7) y no coinciden
 * nominalmente con la copia de `ai`/`@ai-sdk/provider` que instalamos aquí,
 * aunque en tiempo de ejecución el modelo cumple el mismo contrato v2/v3/v4.
 */
export function resolveLanguageModel(config: LlmProviderConfig): MastraModelConfig {
  switch (config.provider) {
    case "anthropic":
      return createAnthropic(
        config.apiKey === undefined ? {} : { apiKey: config.apiKey }
      )(config.model) as unknown as MastraModelConfig;
    case "gemini":
      return createGoogle(
        config.apiKey === undefined ? {} : { apiKey: config.apiKey }
      )(config.model) as unknown as MastraModelConfig;
    case "openai":
    case "ollama":
    case "openrouter":
    case "groq":
      return createOpenAICompatible({
        name: config.provider,
        ...(config.apiKey === undefined ? {} : { apiKey: config.apiKey }),
        baseURL: config.baseUrl ?? OPENAI_COMPATIBLE_DEFAULTS[config.provider]
      })(config.model) as unknown as MastraModelConfig;
  }
}
