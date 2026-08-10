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
  tools: ["FileSystem_Read"]
};

describe("workspace lifecycle reducer", () => {
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
});
