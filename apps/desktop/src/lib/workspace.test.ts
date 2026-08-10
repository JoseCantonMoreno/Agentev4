import type { AgentMessage, SessionConfig } from "@agentev4/shared";
import { describe, expect, it } from "vitest";
import { type callServer } from "./ipc";
import { createWorkspaceSelectionController, prepareWorkspace } from "./workspace";

function session(id: string, updatedAt: string): SessionConfig {
  return {
    id,
    name: id,
    workspacePath: "C:\\repo",
    mode: "agent",
    permissionMode: "default",
    status: "active",
    tokensUsed: 0,
    createdAt: new Date("2026-08-01T10:00:00.000Z"),
    updatedAt: new Date(updatedAt)
  };
}

function message(content: string): AgentMessage {
  return {
    id: `message-${content}`,
    role: "assistant",
    content,
    createdAt: new Date("2026-08-10T10:00:00.000Z")
  };
}

function scriptedRpc(responses: Record<string, unknown>): typeof callServer {
  return async <T>(method: string): Promise<T> => {
    if (!(method in responses)) throw new Error(`Unexpected RPC method: ${method}`);
    return responses[method] as T;
  };
}

describe("prepareWorkspace", () => {
  it("activates the deterministic most-recent session and loads its messages", async () => {
    const rpc = scriptedRpc({
      initWorkspace: {
        workspacePath: "C:\\repo",
        sessions: [
          session("older", "2026-08-09T10:00:00.000Z"),
          session("newer", "2026-08-10T10:00:00.000Z")
        ]
      },
      listTools: ["FileSystem_Read"],
      listMessages: [message("hello")]
    });

    await expect(
      prepareWorkspace({
        workspacePath: "C:\\repo",
        defaultMode: "agent",
        defaultPermissionMode: "default",
        call: rpc
      })
    ).resolves.toMatchObject({ activeSessionId: "newer", tools: ["FileSystem_Read"] });
  });

  it("creates exactly one test session when the workspace is empty", async () => {
    const created = session("created", "2026-08-10T10:00:00.000Z");
    const rpc = scriptedRpc({
      initWorkspace: { workspacePath: "C:\\empty", sessions: [] },
      listTools: [],
      createSession: created,
      listMessages: []
    });

    const ready = await prepareWorkspace({
      workspacePath: "C:\\empty",
      defaultMode: "agent",
      defaultPermissionMode: "default",
      call: rpc
    });
    expect(ready.sessions).toEqual([created]);
    expect(ready.activeSessionId).toBe("created");
  });

  it("breaks session recency ties by createdAt and then id", async () => {
    const sameUpdatedAt = "2026-08-10T10:00:00.000Z";
    const olderCreated = session("a", sameUpdatedAt);
    olderCreated.createdAt = new Date("2026-08-01T10:00:00.000Z");
    const sameCreatedHighId = session("z", sameUpdatedAt);
    sameCreatedHighId.createdAt = new Date("2026-08-02T10:00:00.000Z");
    const sameCreatedLowId = session("b", sameUpdatedAt);
    sameCreatedLowId.createdAt = new Date("2026-08-02T10:00:00.000Z");

    const ready = await prepareWorkspace({
      workspacePath: "C:\\repo",
      defaultMode: "agent",
      defaultPermissionMode: "default",
      call: scriptedRpc({
        initWorkspace: {
          workspacePath: "C:\\repo",
          sessions: [olderCreated, sameCreatedHighId, sameCreatedLowId]
        },
        listTools: [],
        listMessages: []
      })
    });

    expect(ready.sessions.map(({ id }) => id)).toEqual(["b", "z", "a"]);
    expect(ready.activeSessionId).toBe("b");
  });

  it("does not create another automatic session when reopening a workspace", async () => {
    const created = session("created", "2026-08-10T10:00:00.000Z");
    let initialized = false;
    const calls: Array<{ method: string; params?: Record<string, unknown> }> = [];
    const rpc: typeof callServer = async <T>(method: string, params?: Record<string, unknown>) => {
      if (params === undefined) calls.push({ method });
      else calls.push({ method, params });
      if (method === "initWorkspace") {
        const sessions = initialized ? [created] : [];
        initialized = true;
        return { workspacePath: "C:\\empty", sessions } as T;
      }
      if (method === "createSession") return created as T;
      if (method === "listTools" || method === "listMessages") return [] as T;
      throw new Error(`Unexpected RPC method: ${method}`);
    };
    const input = {
      workspacePath: "C:\\empty",
      defaultMode: "agent" as const,
      defaultPermissionMode: "default" as const,
      call: rpc
    };

    await prepareWorkspace(input);
    await prepareWorkspace(input);

    expect(calls.filter(({ method }) => method === "createSession")).toHaveLength(1);
    expect(calls).toContainEqual({
      method: "createSession",
      params: { name: "Sesi\u00f3n de prueba", mode: "agent", permissionMode: "default" }
    });
    expect(calls).toContainEqual({ method: "listMessages", params: { sessionId: "created" } });
  });
});

function deferred<Value>() {
  let resolve: (value: Value) => void;
  let reject: (error: unknown) => void;
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve: resolve!, reject: reject! };
}

describe("workspace selection controller", () => {
  it("dispatches cancellation without preparing a workspace", async () => {
    const actions: Array<{ type: string }> = [];
    const controller = createWorkspaceSelectionController({
      selectWorkspaceFolder: async () => null,
      defaultMode: () => "agent",
      defaultPermissionMode: () => "default",
      dispatch: (action) => actions.push(action)
    });

    await controller.select();

    expect(actions.map(({ type }) => type)).toEqual([
      "WORKSPACE_SELECTION_STARTED",
      "WORKSPACE_SELECTION_CANCELLED"
    ]);
  });

  it("ignores a second synchronous activation and publishes the first result once", async () => {
    const selectedPath = deferred<string | null>();
    const prepared = deferred<Awaited<ReturnType<typeof prepareWorkspace>>>();
    const actions: Array<{ type: string }> = [];
    let prepareCalls = 0;
    const controller = createWorkspaceSelectionController({
      selectWorkspaceFolder: () => selectedPath.promise,
      defaultMode: () => "agent",
      defaultPermissionMode: () => "default",
      prepare: async () => {
        prepareCalls += 1;
        return prepared.promise;
      },
      dispatch: (action) => actions.push(action)
    });

    const first = controller.select();
    const second = controller.select();

    expect(second).toBeUndefined();
    selectedPath.resolve("C:\\repo");
    await Promise.resolve();
    expect(prepareCalls).toBe(1);

    prepared.resolve({
      workspacePath: "C:\\repo",
      sessions: [session("new", "2026-08-10T10:00:00.000Z")],
      activeSessionId: "new",
      messages: [],
      tools: []
    });
    await first;

    expect(actions.map(({ type }) => type)).toEqual([
      "WORKSPACE_SELECTION_STARTED",
      "WORKSPACE_PREPARING",
      "WORKSPACE_READY"
    ]);
    expect(actions.filter(({ type }) => type === "WORKSPACE_READY")).toHaveLength(1);
  });

  it("releases the synchronous lock after preparation failure", async () => {
    const actions: Array<{ type: string }> = [];
    let calls = 0;
    const controller = createWorkspaceSelectionController({
      selectWorkspaceFolder: async () => "C:\\repo",
      defaultMode: () => "agent",
      defaultPermissionMode: () => "default",
      prepare: async () => {
        calls += 1;
        throw new Error("init failed");
      },
      dispatch: (action) => actions.push(action)
    });

    await controller.select();
    await controller.select();

    expect(calls).toBe(2);
    expect(actions.filter(({ type }) => type === "WORKSPACE_PREPARATION_FAILED")).toHaveLength(2);
  });
});
