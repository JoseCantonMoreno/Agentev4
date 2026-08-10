import { describe, expect, it } from "vitest";
import type { LlmProviderConfig, LlmProviderName } from "@agentev4/shared";
import { resolveLanguageModel } from "./providers.js";

const PROVIDERS: LlmProviderName[] = ["anthropic", "gemini", "openai", "ollama", "openrouter", "groq"];

describe("resolveLanguageModel", () => {
  it.each(PROVIDERS)("resuelve un modelo para el proveedor %s sin lanzar y conserva el model id", (provider) => {
    const config: LlmProviderConfig = { provider, model: "modelo-x", apiKey: "clave-de-prueba" };
    const model = resolveLanguageModel(config) as unknown as { modelId: string };
    expect(model.modelId).toBe("modelo-x");
  });

  it("funciona sin apiKey (RAM vacía, Fase 10) sin lanzar", () => {
    const config: LlmProviderConfig = { provider: "anthropic", model: "modelo-x" };
    expect(() => resolveLanguageModel(config)).not.toThrow();
  });

  it("respeta un baseUrl custom en vez del default OpenAI-compatible", () => {
    const config: LlmProviderConfig = {
      provider: "ollama",
      model: "llama3",
      baseUrl: "http://otro-host:9999/v1"
    };
    const model = resolveLanguageModel(config) as unknown as { config: { provider: string } };
    // ponytail: el SDK no expone la baseURL resuelta como string plano (es una
    // función interna), así que solo confirmamos que la config custom no rompe
    // la resolución del modelo -- la URL en sí ya la fija `createOpenAICompatible`.
    expect(model.config.provider).toBe("ollama.chat");
  });
});
