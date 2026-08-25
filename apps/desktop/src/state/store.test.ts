import type { ReadyWorkspace } from "../lib/workspace";
import { describe, expect, it } from "vitest";
import { initialState, reducer } from "./store";

const ready: ReadyWorkspace = {
  workspacePath: "C:\\previous",
  sessions: [
    {
      id: "previous-session",
      name: "Previous",
      workspacePath: "C:\\previous",
      mode: "agent",
      permissionMode: "default",
      status: "active",
      tokensUsed: 0,
      createdAt: new Date("2026-08-01T10:00:00.000Z"),
      updatedAt: new Date("2026-08-10T10:00:00.000Z")
    }
  ],
  activeSessionId: "previous-session",
  messages: [],
  tools: ["FileSystem_Read"],
  agentSettings: {}
};

describe("workspace lifecycle reducer", () => {
  it("correlates prompt completion so an older run cannot release the current run", () => {
    const first = reducer(initialState, { type: "SENDING_STARTED", runId: "run-1" });
    const crashed = reducer(first, {
      type: "SERVER_PROCESS_FAILED",
      error: "El servidor del agente se cerr\u00f3"
    });
    const restarted = reducer(crashed, { type: "SENDING_STARTED", runId: "run-2" });

    const lateFinish = reducer(restarted, { type: "SENDING_FINISHED", runId: "run-1" });

    expect(lateFinish.sending).toBe(true);
    expect(lateFinish.activeRunId).toBe("run-2");
  });

  it("invalidates all process-owned state after a confirmed crash and can restart cleanly", () => {
    let active = reducer(initialState, { type: "WORKSPACE_READY", ready });
    active = reducer(active, {
      type: "PROVIDER_CONFIG_COMMITTED",
      config: { provider: "openai", model: "gpt-5", baseUrl: "" }
    });
    active = reducer(active, {
      type: "AGENT_SETTINGS_COMMITTED",
      settings: { systemPromptOverride: "Se breve." }
    });
    active = reducer(active, { type: "SENDING_STARTED", runId: "run-before-crash" });

    const crashed = reducer(active, {
      type: "SERVER_PROCESS_FAILED",
      error: "El servidor del agente se cerr\u00f3"
    });

    expect(crashed).toMatchObject({
      workspacePath: null,
      workspaceStatus: "idle",
      sessions: [],
      activeSessionId: null,
      messages: [],
      activity: [],
      context: null,
      pendingPermission: null,
      sending: false,
      activeRunId: null,
      error: "El servidor del agente se cerr\u00f3",
      providerConfig: initialState.providerConfig,
      agentSettings: initialState.agentSettings
    });

    const restarted = reducer(crashed, { type: "WORKSPACE_READY", ready });
    expect(restarted.workspaceStatus).toBe("ready");
    expect(restarted.activeSessionId).toBe("previous-session");
  });

  it("discards a late message refresh for a session that is no longer active", () => {
    const active = reducer(initialState, { type: "WORKSPACE_READY", ready });
    const switched = reducer(active, {
      type: "SESSION_ACTIVATED",
      workspacePath: "C:\\previous",
      sessionId: "current-session",
      messages: []
    });
    const afterLateRefresh = reducer(switched, {
      type: "MESSAGES_SET",
      sessionId: "previous-session",
      messages: [
        {
          id: "late",
          role: "assistant",
          content: "late response",
          createdAt: new Date("2026-08-11T10:00:00.000Z")
        }
      ]
    });

    expect(afterLateRefresh.messages).toEqual([]);
  });

  it("refuses workspace and session navigation while a prompt is active", () => {
    const sending = reducer(reducer(initialState, { type: "WORKSPACE_READY", ready }), {
      type: "SENDING_STARTED",
      runId: "run-1"
    });
    const navigationActions = [
      { type: "WORKSPACE_SELECTION_STARTED" as const },
      { type: "WORKSPACE_PREPARING" as const },
      { type: "WORKSPACE_READY" as const, ready: { ...ready, workspacePath: "C:\\other" } },
      { type: "SESSIONS_SET" as const, workspacePath: "C:\\previous", sessions: [] },
      {
        type: "SESSION_ACTIVATED" as const,
        workspacePath: "C:\\previous",
        sessionId: "other",
        messages: []
      }
    ];

    for (const action of navigationActions) expect(reducer(sending, action)).toBe(sending);
  });

  it("ignores session responses from workspace A during and after a transition to B", () => {
    const activeA = reducer(initialState, { type: "WORKSPACE_READY", ready });
    const preparingB = reducer(activeA, { type: "WORKSPACE_PREPARING" });
    const duringTransition = reducer(preparingB, {
      type: "SESSION_ACTIVATED",
      workspacePath: "C:\\previous",
      sessionId: "late-a",
      messages: []
    });
    const readyB = reducer(preparingB, {
      type: "WORKSPACE_READY",
      ready: {
        ...ready,
        workspacePath: "C:\\next",
        sessions: [{ ...ready.sessions[0]!, id: "next-session", workspacePath: "C:\\next" }],
        activeSessionId: "next-session"
      }
    });
    const afterTransition = reducer(readyB, {
      type: "SESSIONS_SET",
      workspacePath: "C:\\previous",
      sessions: []
    });

    expect(duringTransition).toBe(preparingB);
    expect(afterTransition).toBe(readyB);
  });

  it("preserves the active workspace when folder selection is cancelled", () => {
    const active = reducer(initialState, { type: "WORKSPACE_READY", ready });
    const cancelled = reducer(reducer(active, { type: "WORKSPACE_SELECTION_STARTED" }), {
      type: "WORKSPACE_SELECTION_CANCELLED"
    });

    expect(cancelled.workspaceStatus).toBe("ready");
    expect(cancelled.workspacePath).toBe("C:\\previous");
    expect(cancelled.activeSessionId).toBe("previous-session");
  });

  it("preserves the active workspace and releases busy state after preparation fails", () => {
    const active = reducer(initialState, { type: "WORKSPACE_READY", ready });
    const failed = reducer(reducer(active, { type: "WORKSPACE_PREPARING" }), {
      type: "WORKSPACE_PREPARATION_FAILED",
      error: "init failed"
    });

    expect(failed.workspaceStatus).toBe("ready");
    expect(failed.workspacePath).toBe("C:\\previous");
    expect(failed.sessions).toEqual(ready.sessions);
    expect(failed.error).toBe("init failed");
  });

  it("accumulates consecutive deltas with the same messageId into one growing bubble", () => {
    const active = reducer(initialState, { type: "WORKSPACE_READY", ready });
    const afterFirst = reducer(active, {
      type: "SERVER_EVENT",
      event: { type: "agent:message_delta", sessionId: "previous-session", messageId: "msg-1", delta: "Voy a " }
    });
    const afterSecond = reducer(afterFirst, {
      type: "SERVER_EVENT",
      event: {
        type: "agent:message_delta",
        sessionId: "previous-session",
        messageId: "msg-1",
        delta: "mirar el repo"
      }
    });

    expect(afterSecond.activity).toEqual([
      { kind: "assistant_delta", messageId: "msg-1", content: "Voy a mirar el repo" }
    ]);
  });

  it("opens a new activity entry when the messageId changes (retry or next turn), and interleaves tool calls chronologically", () => {
    const active = reducer(initialState, { type: "WORKSPACE_READY", ready });
    const afterFirstTurn = reducer(active, {
      type: "SERVER_EVENT",
      event: { type: "agent:message_delta", sessionId: "previous-session", messageId: "msg-1", delta: "Voy a mirar el repo" }
    });
    const afterToolCall = reducer(afterFirstTurn, {
      type: "SERVER_EVENT",
      event: {
        type: "agent:tool_call",
        sessionId: "previous-session",
        toolCall: { id: "call-1", name: "FileSystem_Read", input: {} }
      }
    });
    const afterRetry = reducer(afterToolCall, {
      type: "SERVER_EVENT",
      event: { type: "agent:message_delta", sessionId: "previous-session", messageId: "msg-2", delta: "Ya lo tengo" }
    });

    expect(afterRetry.activity).toEqual([
      { kind: "assistant_delta", messageId: "msg-1", content: "Voy a mirar el repo" },
      { kind: "tool_call", toolCall: { id: "call-1", name: "FileSystem_Read", input: {} } },
      { kind: "assistant_delta", messageId: "msg-2", content: "Ya lo tengo" }
    ]);
  });

  it("clears the in-progress activity log when a new prompt starts", () => {
    const active = reducer(initialState, { type: "WORKSPACE_READY", ready });
    const withActivity = reducer(active, {
      type: "SERVER_EVENT",
      event: { type: "agent:message_delta", sessionId: "previous-session", messageId: "msg-1", delta: "..." }
    });

    const started = reducer(withActivity, { type: "SENDING_STARTED", runId: "run-1" });

    expect(started.activity).toEqual([]);
  });

  it("clears the in-progress activity log once the authoritative message refetch lands", () => {
    const active = reducer(initialState, { type: "WORKSPACE_READY", ready });
    const withActivity = reducer(active, {
      type: "SERVER_EVENT",
      event: { type: "agent:message_delta", sessionId: "previous-session", messageId: "msg-1", delta: "..." }
    });

    const reconciled = reducer(withActivity, {
      type: "MESSAGES_SET",
      sessionId: "previous-session",
      messages: []
    });

    expect(reconciled.activity).toEqual([]);
  });
});
