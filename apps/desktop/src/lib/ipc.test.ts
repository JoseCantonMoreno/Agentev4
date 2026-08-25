import { describe, expect, it } from "vitest";
import { rpcPolicyForMethod, validateRpcResult } from "./ipc";

describe("RPC method contracts", () => {
  it.each([
    "sendPrompt",
    "initWorkspace",
    "createSession",
    "renameSession",
    "deleteSession",
    "restoreCheckpoint",
    "saveProviderSettings",
    "saveAgentSettings",
    "setApiKey",
    "respondPermission"
  ])("does not apply a consumer timeout to mutating method %s", (method) => {
    expect(rpcPolicyForMethod(method)).toEqual({ timeoutMs: false });
  });

  it("keeps a bounded timeout for read-only methods", () => {
    expect(rpcPolicyForMethod("listSessions")).toEqual({ timeoutMs: 30_000 });
  });

  it("validates critical results by method instead of trusting a generic cast", () => {
    expect(() => validateRpcResult("listSessions", [{ id: 123 }])).toThrow(
      "Respuesta RPC inv\u00e1lida para listSessions"
    );
    expect(() =>
      validateRpcResult("saveProviderSettings", {
        config: { provider: "openai", model: "gpt-5" },
        hasApiKey: true,
        apiKey: "must-never-cross-the-protocol"
      })
    ).toThrow("Respuesta RPC inv\u00e1lida para saveProviderSettings");
  });

  it("validates and round-trips saveAgentSettings", () => {
    expect(
      validateRpcResult("saveAgentSettings", { systemPromptOverride: "Se breve." })
    ).toEqual({ systemPromptOverride: "Se breve." });
    expect(() =>
      validateRpcResult("saveAgentSettings", { systemPromptOverride: 42 })
    ).toThrow("Respuesta RPC inv\u00e1lida para saveAgentSettings");
  });

  it("validates the agentSettings field on initWorkspace and rejects a leaked apiKey there too", () => {
    const readyWorkspace = {
      workspacePath: "C:\\repo",
      activeSessionId: "session-1",
      sessions: [],
      messages: [],
      tools: [],
      agentSettings: { systemPromptOverride: "Se breve." }
    };
    expect(validateRpcResult("initWorkspace", readyWorkspace)).toMatchObject({
      agentSettings: { systemPromptOverride: "Se breve." }
    });
    expect(() =>
      validateRpcResult("initWorkspace", {
        ...readyWorkspace,
        agentSettings: { systemPromptOverride: "ok", apiKey: "must-never-cross-the-protocol" }
      })
    ).toThrow("Respuesta RPC inv\u00e1lida para initWorkspace");
  });
});
