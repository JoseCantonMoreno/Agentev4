import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { KeyStore } from "@agentev4/core";
import { saveProviderSettings } from "./provider-settings.js";

interface RunLoopResult {
  messages: unknown[];
  haltReason: string;
  turnsUsed: number;
  costUsd: number;
}

const testState: {
  providerConfigs: Array<Record<string, unknown>>;
  runLoopOverride: ((messages: unknown[]) => Promise<RunLoopResult>) | undefined;
} = { providerConfigs: [], runLoopOverride: undefined };

function deferred<Value>() {
  let resolve: (value: Value) => void;
  const promise = new Promise<Value>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve: resolve! };
}

function mockServerDependencies(): void {
  vi.doMock("@agentev4/core", () => {
    class TestKeyStore {
      private readonly keys = new Map<string, string>();

      set(provider: string, apiKey: string): void {
        this.keys.set(provider, apiKey);
      }

      get(provider: string): string | undefined {
        return this.keys.get(provider);
      }

      has(provider: string): boolean {
        return this.keys.has(provider);
      }
    }

    class TestSessionManager {
      private readonly sessions = new Map<
        string,
        {
          id: string;
          name: string;
          workspacePath: string;
          mode: "assistant";
          permissionMode: "default";
          status: "active";
          tokensUsed: number;
          createdAt: Date;
          updatedAt: Date;
        }
      >();
      private readonly messages = new Map<string, Array<{ role: string; content: string }>>();

      createSession(input: { name: string; workspacePath: string }) {
        const now = new Date("2026-08-10T10:00:00.000Z");
        const session = {
          id: "provider-settings-session",
          name: input.name,
          workspacePath: input.workspacePath,
          mode: "assistant" as const,
          permissionMode: "default" as const,
          status: "active" as const,
          tokensUsed: 0,
          createdAt: now,
          updatedAt: now
        };
        this.sessions.set(session.id, session);
        this.messages.set(session.id, []);
        return session;
      }

      listSessions() {
        return [...this.sessions.values()];
      }

      getSession(sessionId: string) {
        return this.sessions.get(sessionId);
      }

      appendMessage(sessionId: string, message: { role: string; content: string }) {
        this.messages.get(sessionId)?.push(message);
      }

      listMessages(sessionId: string) {
        return this.messages.get(sessionId) ?? [];
      }
    }

    return {
      KeyStore: TestKeyStore,
      SessionManager: TestSessionManager,
      openDatabase: () => ({ db: {}, close: () => undefined }),
      PermissionEngine: class {},
      countContextTokens: () => ({ total: 0 }),
      createMastraAgentFactory: () => ({
        create(config: Record<string, unknown>) {
          testState.providerConfigs.push(config);
          return {
            run: async () => ({
              message: {
                id: "assistant-message",
                role: "assistant",
                content: "configured response",
                createdAt: new Date()
              },
              toolCalls: [],
              stopReason: "end_turn",
              costUsd: 0
            }),
            submitToolResult: async () => undefined
          };
        }
      }),
      createResilientAgent: <T>(agent: T) => agent,
      runAgenticLoop: async ({
        agent,
        messages
      }: {
        agent: { run(input: unknown): Promise<{ message: unknown; stopReason: string }> };
        messages: unknown[];
      }) => {
        if (testState.runLoopOverride) return testState.runLoopOverride(messages);
        const result = await agent.run({ messages });
        return {
          messages: [...messages, result.message],
          haltReason: result.stopReason,
          turnsUsed: 1,
          costUsd: 0
        };
      }
    };
  });

  vi.doMock("@agentev4/tools", () => ({
    createStaticToolRegistry: () => ({}),
    executeRegisteredTool: vi.fn()
  }));
}

function getHandler(handlers: Record<string, unknown>, method: string) {
  const handler = handlers[method];
  if (typeof handler !== "function") throw new Error(`Missing RPC handler: ${method}`);
  return handler as (
    params: Record<string, unknown>,
    emit: (event: unknown) => void
  ) => Promise<unknown>;
}

async function loadHandlers() {
  testState.providerConfigs = [];
  testState.runLoopOverride = undefined;
  vi.resetModules();
  mockServerDependencies();
  return (await import("./index.js")).handlers;
}

async function createSession(handlers: Record<string, unknown>, workspacePath: string) {
  await getHandler(handlers, "initWorkspace")(
    { workspacePath, defaultMode: "assistant", defaultPermissionMode: "default" },
    () => undefined
  );
  return getHandler(handlers, "createSession")(
    { name: "Provider settings test", mode: "assistant", permissionMode: "default" },
    () => undefined
  ) as Promise<{ id: string }>;
}

describe("saveProviderSettings", () => {
  it.each([
    { defaultMode: "unattended", defaultPermissionMode: "default" },
    { defaultMode: "agent", defaultPermissionMode: "unrestricted" }
  ])(
    "rejects invalid initWorkspace input before touching disk: $defaultMode/$defaultPermissionMode",
    async (invalid) => {
      const workspacePath = await mkdtemp(join(tmpdir(), "agentev4-invalid-init-"));
      try {
        const handlers = await loadHandlers();

        await expect(
          getHandler(handlers, "initWorkspace")({ workspacePath, ...invalid }, () => undefined)
        ).rejects.toThrow();
        await expect(access(join(workspacePath, ".agente"))).rejects.toMatchObject({
          code: "ENOENT"
        });
      } finally {
        await rm(workspacePath, { recursive: true, force: true });
      }
    }
  );

  it.each([
    "initWorkspace",
    "createSession",
    "renameSession",
    "deleteSession",
    "restoreCheckpoint",
    "sendPrompt"
  ])(
    "rejects concurrent session mutation %s while workspace initialization is in progress",
    async (method) => {
      const firstWorkspace = await mkdtemp(join(tmpdir(), "agentev4-transition-a-"));
      const secondWorkspace = await mkdtemp(join(tmpdir(), "agentev4-transition-b-"));
      try {
        const handlers = await loadHandlers();
        const session = await createSession(handlers, firstWorkspace);
        const transition = getHandler(handlers, "initWorkspace")(
          {
            workspacePath: secondWorkspace,
            defaultMode: "assistant",
            defaultPermissionMode: "default"
          },
          () => undefined
        );
        const paramsByMethod: Record<string, Record<string, unknown>> = {
          initWorkspace: {
            workspacePath: firstWorkspace,
            defaultMode: "assistant",
            defaultPermissionMode: "default"
          },
          createSession: { name: "Blocked", mode: "assistant", permissionMode: "default" },
          renameSession: { sessionId: session.id, name: "Blocked" },
          deleteSession: { sessionId: session.id },
          restoreCheckpoint: { sessionId: session.id, checkpointId: "blocked" },
          sendPrompt: { sessionId: session.id, prompt: "Blocked" }
        };

        await expect(
          getHandler(handlers, method)(paramsByMethod[method]!, () => undefined)
        ).rejects.toThrow("cambio de workspace en curso");
        await expect(transition).resolves.toMatchObject({ workspacePath: secondWorkspace });
      } finally {
        await Promise.all([
          rm(firstWorkspace, { recursive: true, force: true }),
          rm(secondWorkspace, { recursive: true, force: true })
        ]);
      }
    }
  );

  it("releases the workspace transition guard when initialization fails", async () => {
    const validWorkspace = await mkdtemp(join(tmpdir(), "agentev4-transition-retry-"));
    const missingWorkspace = join(validWorkspace, "missing");
    try {
      const handlers = await loadHandlers();

      await expect(
        getHandler(handlers, "initWorkspace")(
          {
            workspacePath: missingWorkspace,
            defaultMode: "assistant",
            defaultPermissionMode: "default"
          },
          () => undefined
        )
      ).rejects.toThrow();
      await expect(
        getHandler(handlers, "initWorkspace")(
          {
            workspacePath: validWorkspace,
            defaultMode: "assistant",
            defaultPermissionMode: "default"
          },
          () => undefined
        )
      ).resolves.toMatchObject({ workspacePath: validWorkspace });
    } finally {
      await rm(validWorkspace, { recursive: true, force: true });
    }
  });

  it.each(["createSession", "renameSession", "deleteSession", "restoreCheckpoint"])(
    "rejects workspace/session mutation %s while any prompt is active",
    async (method) => {
      const workspacePath = await mkdtemp(join(tmpdir(), "agentev4-active-mutation-"));
      const runStarted = deferred<void>();
      const finishRun = deferred<void>();
      try {
        const handlers = await loadHandlers();
        const session = await createSession(handlers, workspacePath);
        await getHandler(handlers, "saveProviderSettings")(
          { provider: "ollama", model: "saved-model", baseUrl: "" },
          () => undefined
        );
        testState.runLoopOverride = async (messages) => {
          runStarted.resolve();
          await finishRun.promise;
          return { messages, haltReason: "end_turn", turnsUsed: 1, costUsd: 0 };
        };

        const prompt = getHandler(handlers, "sendPrompt")(
          { sessionId: session.id, prompt: "keep mutation guard active" },
          () => undefined
        );
        await runStarted.promise;
        const paramsByMethod: Record<string, Record<string, unknown>> = {
          createSession: { name: "Blocked", mode: "assistant", permissionMode: "default" },
          renameSession: { sessionId: session.id, name: "Blocked" },
          deleteSession: { sessionId: session.id },
          restoreCheckpoint: { sessionId: session.id, checkpointId: "blocked" }
        };
        try {
          await expect(
            getHandler(handlers, method)(paramsByMethod[method]!, () => undefined)
          ).rejects.toThrow("Hay un prompt activo");
        } finally {
          finishRun.resolve();
          await prompt;
        }
      } finally {
        await rm(workspacePath, { recursive: true, force: true });
      }
    }
  );

  it("rejects workspace initialization during a prompt and releases the guard afterwards", async () => {
    const firstWorkspace = await mkdtemp(join(tmpdir(), "agentev4-active-prompt-a-"));
    const secondWorkspace = await mkdtemp(join(tmpdir(), "agentev4-active-prompt-b-"));
    const runStarted = deferred<void>();
    const finishRun = deferred<void>();
    try {
      const handlers = await loadHandlers();
      const session = await createSession(handlers, firstWorkspace);
      await getHandler(handlers, "saveProviderSettings")(
        { provider: "ollama", model: "saved-model", baseUrl: "" },
        () => undefined
      );
      testState.runLoopOverride = async (messages) => {
        runStarted.resolve();
        await finishRun.promise;
        return { messages, haltReason: "end_turn", turnsUsed: 1, costUsd: 0 };
      };

      const prompt = getHandler(handlers, "sendPrompt")(
        { sessionId: session.id, prompt: "keep workspace A active" },
        () => undefined
      );
      await runStarted.promise;
      try {
        await expect(
          getHandler(handlers, "initWorkspace")(
            {
              workspacePath: secondWorkspace,
              defaultMode: "assistant",
              defaultPermissionMode: "default"
            },
            () => undefined
          )
        ).rejects.toThrow("Hay un prompt activo");
      } finally {
        finishRun.resolve();
        await prompt;
      }

      await expect(
        getHandler(handlers, "initWorkspace")(
          {
            workspacePath: secondWorkspace,
            defaultMode: "assistant",
            defaultPermissionMode: "default"
          },
          () => undefined
        )
      ).resolves.toMatchObject({ workspacePath: secondWorkspace });
    } finally {
      await Promise.all([
        rm(firstWorkspace, { recursive: true, force: true }),
        rm(secondWorkspace, { recursive: true, force: true })
      ]);
    }
  });

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

  it("does not persist a prompt when no provider settings have been saved", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "agentev4-provider-settings-"));
    try {
      const handlers = await loadHandlers();
      const session = await createSession(handlers, workspacePath);

      await expect(
        getHandler(handlers, "sendPrompt")(
          { sessionId: session.id, prompt: "do not persist me" },
          () => undefined
        )
      ).rejects.toThrow("No hay configuración de proveedor guardada todavía.");
      await expect(
        getHandler(handlers, "listMessages")({ sessionId: session.id }, () => undefined)
      ).resolves.toEqual([]);
    } finally {
      await rm(workspacePath, { recursive: true, force: true });
    }
  });

  it("uses saved provider settings instead of caller-supplied prompt settings", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "agentev4-provider-settings-"));
    try {
      const handlers = await loadHandlers();
      const session = await createSession(handlers, workspacePath);
      const savedBaseUrl = "http://127.0.0.1:11434/v1";
      await getHandler(handlers, "saveProviderSettings")(
        { provider: "ollama", model: "saved-model", baseUrl: savedBaseUrl },
        () => undefined
      );

      await expect(
        getHandler(handlers, "sendPrompt")(
          {
            sessionId: session.id,
            prompt: "answer using the saved config",
            provider: "openai",
            model: "caller-model",
            baseUrl: "https://caller.example/v1"
          },
          () => undefined
        )
      ).resolves.toMatchObject({ haltReason: "end_turn", turnsUsed: 1 });
      expect(testState.providerConfigs).toEqual([
        { provider: "ollama", model: "saved-model", baseUrl: savedBaseUrl, apiKey: undefined }
      ]);
    } finally {
      await rm(workspacePath, { recursive: true, force: true });
    }
  });
});
