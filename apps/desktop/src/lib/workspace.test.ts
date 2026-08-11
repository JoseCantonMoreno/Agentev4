import type { AgentMessage, SessionConfig } from "@agentev4/shared";
import { describe, expect, it } from "vitest";
import { type callServer } from "./ipc";
import {
  createWorkspaceSelectionController,
  createWorkspaceSession,
  listSessionMessages,
  listWorkspaceSessions,
  prepareWorkspace
} from "./workspace";

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

describe("prepareWorkspace", () => {
  it("rehydrates JSON dates and prepares the workspace with one RPC", async () => {
    const serializedReady = JSON.parse(
      JSON.stringify({
        workspacePath: "C:\\repo",
        sessions: [session("serialized", "2026-08-10T10:00:00.000Z")],
        activeSessionId: "serialized",
        messages: [message("from JSON")],
        tools: ["FileSystem_Read"]
      })
    ) as unknown;
    const calls: Array<{ method: string; params?: Record<string, unknown> }> = [];
    const rpc: typeof callServer = async <T>(
      method: string,
      params?: Record<string, unknown>
    ): Promise<T> => {
      calls.push(params === undefined ? { method } : { method, params });
      return serializedReady as T;
    };

    const ready = await prepareWorkspace({
      workspacePath: "C:\\repo",
      defaultMode: "agent",
      defaultPermissionMode: "default",
      call: rpc
    });

    expect(calls).toEqual([
      {
        method: "initWorkspace",
        params: {
          workspacePath: "C:\\repo",
          defaultMode: "agent",
          defaultPermissionMode: "default"
        }
      }
    ]);
    expect(ready.sessions[0]?.updatedAt).toBeInstanceOf(Date);
    expect(ready.messages[0]?.createdAt).toBeInstanceOf(Date);
  });
});

describe("workspace session RPC parsing", () => {
  it("rehydrates JSON dates for session creation and UI listings", async () => {
    const serializedSession = JSON.parse(
      JSON.stringify(session("serialized", "2026-08-10T10:00:00.000Z"))
    ) as unknown;
    const serializedMessage = JSON.parse(JSON.stringify(message("serialized"))) as unknown;
    const rpc: typeof callServer = async <T>(method: string): Promise<T> => {
      if (method === "listSessions") return [serializedSession] as T;
      if (method === "createSession") return serializedSession as T;
      if (method === "listMessages") return [serializedMessage] as T;
      throw new Error(`Unexpected RPC method: ${method}`);
    };
    const [listedSession] = await listWorkspaceSessions(rpc);
    const createdSession = await createWorkspaceSession(
      { name: "Serialized", mode: "agent", permissionMode: "default" },
      rpc
    );
    const [listedMessage] = await listSessionMessages("serialized", rpc);

    expect(listedSession?.createdAt).toBeInstanceOf(Date);
    expect(createdSession.updatedAt).toBeInstanceOf(Date);
    expect(listedMessage?.createdAt).toBeInstanceOf(Date);
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
