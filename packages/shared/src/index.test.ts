import { describe, expect, it } from "vitest";
import {
  AgentMessageSchema,
  ToolCallSchema,
  ToolResultSchema,
  LlmProviderConfigSchema,
  SessionConfigSchema,
  AgentIpcEventSchema
} from "./index.js";

describe("packages/shared schemas", () => {
  it("parses a valid AgentMessage", () => {
    const message = AgentMessageSchema.parse({
      id: "msg_1",
      role: "user",
      content: "hola",
      createdAt: new Date().toISOString()
    });
    expect(message.role).toBe("user");
  });

  it("parses ToolCall and ToolResult", () => {
    const call = ToolCallSchema.parse({ id: "call_1", name: "FileSystem_Read", input: {} });
    const result = ToolResultSchema.parse({ toolCallId: call.id, output: "contenido" });
    expect(result.isError).toBe(false);
  });

  it("parses a valid LlmProviderConfig", () => {
    const config = LlmProviderConfigSchema.parse({ provider: "anthropic", model: "claude" });
    expect(config.provider).toBe("anthropic");
  });

  it("rejects an unknown provider", () => {
    expect(() => LlmProviderConfigSchema.parse({ provider: "bard", model: "x" })).toThrow();
  });

  it("parses a valid SessionConfig", () => {
    const now = new Date().toISOString();
    const session = SessionConfigSchema.parse({
      id: "s1",
      name: "Sesión 1",
      workspacePath: "I:/Desktop/Agentev4",
      mode: "agent",
      permissionMode: "default",
      createdAt: now,
      updatedAt: now
    });
    expect(session.mode).toBe("agent");
  });

  it("discriminates AgentIpcEvent by type", () => {
    const event = AgentIpcEventSchema.parse({
      type: "agent:context_update",
      sessionId: "s1",
      usedTokens: 100,
      maxTokens: 200000
    });
    expect(event.type).toBe("agent:context_update");
  });
});
