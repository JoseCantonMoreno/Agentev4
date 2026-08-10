import { describe, expect, it } from "vitest";
import { ContextInspector } from "./context-inspector.js";

describe("Context_Inspector", () => {
  it("cuenta mensajes por rol y estima tokens", async () => {
    const result = await ContextInspector.handler({
      messages: [
        { id: "1", role: "user", content: "hola" },
        { id: "2", role: "assistant", content: "hola de vuelta" },
        { id: "3", role: "tool", content: "resultado" }
      ]
    });

    expect(result.totalMessages).toBe(3);
    expect(result.byRole).toEqual({ user: 1, assistant: 1, tool: 1 });
    expect(result.estimatedTokens).toBeGreaterThan(0);
  });

  it("devuelve ceros con una conversación vacía", async () => {
    const result = await ContextInspector.handler({ messages: [] });
    expect(result).toEqual({ totalMessages: 0, byRole: {}, estimatedTokens: 0 });
  });
});
