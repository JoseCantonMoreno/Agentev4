import { describe, expect, it } from "vitest";
import { KeyStore } from "@agentev4/core";
import { saveProviderSettings } from "./provider-settings.js";

describe("saveProviderSettings", () => {
  it("validates everything before storing a new API key", () => {
    const keyStore = new KeyStore();

    expect(() =>
      saveProviderSettings(keyStore, {
        provider: "anthropic",
        model: "   ",
        baseUrl: "",
        apiKey: "secret-that-must-not-be-stored"
      })
    ).toThrow("El modelo es obligatorio");
    expect(keyStore.has("anthropic")).toBe(false);
  });

  it("requires a key for a remote provider only when none exists in RAM", () => {
    const keyStore = new KeyStore();
    expect(() =>
      saveProviderSettings(keyStore, { provider: "openai", model: "gpt-5", baseUrl: "" })
    ).toThrow("La API key es obligatoria");

    keyStore.set("openai", "existing-secret");
    const saved = saveProviderSettings(keyStore, {
      provider: "openai",
      model: "gpt-5",
      baseUrl: ""
    });
    expect(saved).toEqual({
      config: { provider: "openai", model: "gpt-5" },
      hasApiKey: true
    });
    expect(JSON.stringify(saved)).not.toContain("existing-secret");
  });

  it("allows Ollama without a key and normalizes an empty base URL", () => {
    const saved = saveProviderSettings(new KeyStore(), {
      provider: "ollama",
      model: "qwen3-coder",
      baseUrl: ""
    });
    expect(saved).toEqual({
      config: { provider: "ollama", model: "qwen3-coder" },
      hasApiKey: false
    });
  });

  it("rejects an invalid base URL without replacing an existing key", () => {
    const keyStore = new KeyStore();
    keyStore.set("groq", "old-secret");
    expect(() =>
      saveProviderSettings(keyStore, {
        provider: "groq",
        model: "llama",
        baseUrl: "not-a-url",
        apiKey: "new-secret"
      })
    ).toThrow();
    expect(keyStore.get("groq")).toBe("old-secret");
  });
});
