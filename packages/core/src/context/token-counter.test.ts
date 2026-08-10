import { describe, expect, it } from "vitest";
import { countContextTokens, countTokens } from "./token-counter.js";

describe("countTokens", () => {
  it("aproxima ~4 caracteres por token", () => {
    expect(countTokens("")).toBe(0);
    expect(countTokens("abcd")).toBe(1);
    expect(countTokens("abcdefgh")).toBe(2);
    expect(countTokens("abcdefghi")).toBe(3);
  });
});

describe("countContextTokens", () => {
  it("desglosa por componente (system prompt, reglas, tools, historial) y suma el total", () => {
    const breakdown = countContextTokens({
      systemPrompt: "1234",
      rules: "12345678",
      tools: "1234",
      messages: [
        { id: "1", role: "user", content: "1234", createdAt: new Date() },
        { id: "2", role: "assistant", content: "12345678", createdAt: new Date() }
      ]
    });
    expect(breakdown).toEqual({ systemPrompt: 1, rules: 2, tools: 1, history: 3, total: 7 });
  });

  it("ignora componentes vacíos sin fallar", () => {
    const breakdown = countContextTokens({ systemPrompt: "", rules: "", tools: "", messages: [] });
    expect(breakdown).toEqual({ systemPrompt: 0, rules: 0, tools: 0, history: 0, total: 0 });
  });
});
