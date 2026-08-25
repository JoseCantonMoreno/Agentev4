import { describe, expect, it } from "vitest";
import {
  AgentMessageSchema,
  ToolCallSchema,
  ToolResultSchema,
  LlmProviderConfigSchema,
  InitWorkspaceInputSchema,
  SessionConfigSchema,
  AgentIpcEventSchema,
  AgentSettingsSchema
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
    expect(session.status).toBe("active");
    expect(session.tokensUsed).toBe(0);
  });

  it("rejects invalid workspace initialization modes at the shared boundary", () => {
    expect(
      InitWorkspaceInputSchema.parse({
        workspacePath: "C:\\repo",
        defaultMode: "agent",
        defaultPermissionMode: "default"
      })
    ).toEqual({
      workspacePath: "C:\\repo",
      defaultMode: "agent",
      defaultPermissionMode: "default"
    });
    expect(() =>
      InitWorkspaceInputSchema.parse({
        workspacePath: "C:\\repo",
        defaultMode: "unattended",
        defaultPermissionMode: "default"
      })
    ).toThrow();
    expect(() =>
      InitWorkspaceInputSchema.parse({
        workspacePath: "C:\\repo",
        defaultMode: "agent",
        defaultPermissionMode: "unrestricted"
      })
    ).toThrow();
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

  it("parses agent:permission_request (HITL, Fase 11)", () => {
    const event = AgentIpcEventSchema.parse({
      type: "agent:permission_request",
      sessionId: "s1",
      requestId: "req_1",
      toolCall: { id: "call_1", name: "FileSystem_Write", input: { path: "a.txt" } }
    });
    expect(event.type).toBe("agent:permission_request");
  });

  it("parses agent:message_delta (streaming token a token)", () => {
    const event = AgentIpcEventSchema.parse({
      type: "agent:message_delta",
      sessionId: "s1",
      messageId: "msg_1",
      delta: "Hola"
    });
    expect(event.type).toBe("agent:message_delta");
  });

  it("rejects agent:message_delta sin messageId", () => {
    expect(() =>
      AgentIpcEventSchema.parse({ type: "agent:message_delta", sessionId: "s1", delta: "Hola" })
    ).toThrow();
  });

  it("parsea AgentSettings con override y sin él (Fase 2)", () => {
    expect(AgentSettingsSchema.parse({})).toEqual({});
    expect(AgentSettingsSchema.parse({ systemPromptOverride: "Sé breve." })).toEqual({
      systemPromptOverride: "Sé breve."
    });
  });

  it("AgentSettings descarta campos desconocidos como apiKey (nunca debe persistirse ahí)", () => {
    const parsed = AgentSettingsSchema.parse({
      systemPromptOverride: "ok",
      apiKey: "sk-should-be-stripped"
    });
    expect(parsed).not.toHaveProperty("apiKey");
  });
});
