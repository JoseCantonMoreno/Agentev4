# Workspace, Chat and Provider Feedback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make folder selection reliably prepare a persisted chat session and make provider/model/API-key saving an explicit atomic action confirmed by a visible popup.

**Architecture:** Keep Tauri shell access isolated in the desktop transport, extract testable RPC/workspace orchestration units, and publish workspace readiness to React in one reducer transition. Provider settings are validated in shared/server boundaries, secrets remain only in `KeyStore`, and UI feedback lives globally so failures remain visible before a session exists.

**Tech Stack:** TypeScript 5.7, React 19, Vite 6, Vitest 2, Testing Library, Zod, Tauri v2 shell/dialog plugins, SQLite/Drizzle.

## Global Constraints

- API keys remain exclusively in RAM and never appear in logs, RPC responses, React serializable state, or SQLite.
- Provider, model, and base URL are effective only for the current application execution; this change does not add disk persistence.
- A new workspace receives exactly one automatic session named `Sesión de prueba`; an existing workspace activates its deterministic most-recent session.
- The success copy is exactly `Configuración guardada correctamente` and appears only after server confirmation.
- Keep the current neutral/emerald visual language and add no animation or runtime UI dependency.
- Do not modify or stage the user's pre-existing changes in `apps/desktop/src-tauri/Cargo.toml` or `apps/desktop/src-tauri/tauri.conf.json`.
- Use strict TDD: every production behavior starts with a focused test that fails for the intended missing behavior.

---

## File Structure

- `packages/shared/src/schemas/provider.ts`: shared request/response schemas for provider settings.
- `apps/desktop/server/src/provider-settings.ts`: validate and atomically apply provider settings to `KeyStore`.
- `apps/desktop/server/src/provider-settings.test.ts`: secret-safety and validation tests.
- `apps/desktop/server/src/workspace.ts`: transactional workspace switching.
- `apps/desktop/server/src/workspace.test.ts`: real temporary-directory/SQLite tests.
- `apps/desktop/server/src/index.ts`: wire the extracted services into RPC handlers and consume saved provider settings.
- `apps/desktop/src/lib/rpc-client.ts`: transport-independent JSON-lines RPC state machine.
- `apps/desktop/src/lib/rpc-client.test.ts`: response, timeout, crash, and restart tests.
- `apps/desktop/src/lib/ipc.ts`: thin Tauri adapter around `RpcClient`.
- `apps/desktop/src/lib/workspace.ts`: deterministic session selection and workspace preparation orchestration.
- `apps/desktop/src/lib/workspace.test.ts`: orchestration tests with literal RPC fixtures.
- `apps/desktop/src/state/store.tsx`: atomic workspace-ready state and global notifications.
- `apps/desktop/src/components/GlobalFeedback.tsx`: accessible success/error popup layer.
- `apps/desktop/src/components/WorkspaceSelector.tsx`: drive preparation states and publish one ready transition.
- `apps/desktop/src/components/ChatPanel.tsx`: explicit pre-workspace/pre-session/loading states.
- `apps/desktop/src/components/SettingsPanel.tsx`: local draft, atomic save, success/error feedback.
- `apps/desktop/src/components/workspace-flow.test.tsx`: user-level workspace-to-chat behavior.
- `apps/desktop/src/components/settings-flow.test.tsx`: user-level save and popup behavior.
- `apps/desktop/src/App.tsx`: mount global feedback outside conditional panels.
- `apps/desktop/src-tauri/capabilities/default.json`: minimum spawn/stdin permissions for the declared Node command.
- `apps/desktop/package.json` and `pnpm-lock.yaml`: DOM test-only development dependencies.

---

### Task 1: Shared and Server-Side Provider Settings Contract

**Files:**
- Modify: `packages/shared/src/schemas/provider.ts`
- Create: `apps/desktop/server/src/provider-settings.ts`
- Create: `apps/desktop/server/src/provider-settings.test.ts`
- Modify: `apps/desktop/server/src/index.ts`

**Interfaces:**
- Consumes: `KeyStore`, `LlmProviderNameSchema`, current `LlmProviderConfig`.
- Produces: `ProviderSettingsInput`, `SavedProviderSettings`, and `saveProviderSettings(keyStore, input)`.

- [ ] **Step 1: Write the failing provider-settings tests**

Create tests covering real `KeyStore` mutation and sanitized output:

```ts
import { describe, expect, it } from "vitest";
import { KeyStore } from "@agentev4/core";
import { saveProviderSettings } from "./provider-settings.js";

describe("saveProviderSettings", () => {
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
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `pnpm exec vitest run --project desktop server/src/provider-settings.test.ts`

Expected: FAIL because `provider-settings.ts` and `saveProviderSettings` do not exist.

- [ ] **Step 3: Add shared schemas and the minimal atomic implementation**

Add these contracts to `packages/shared/src/schemas/provider.ts`:

```ts
export const ProviderSettingsInputSchema = z.object({
  provider: LlmProviderNameSchema,
  model: z.string().trim().min(1, "El modelo es obligatorio."),
  baseUrl: z.string().trim().default("").refine(
    (value) => value === "" || z.string().url().safeParse(value).success,
    "La URL base no es válida."
  ),
  apiKey: z.string().optional()
});
export type ProviderSettingsInput = z.infer<typeof ProviderSettingsInputSchema>;

export const SavedProviderSettingsSchema = z.object({
  config: z.object({
    provider: LlmProviderNameSchema,
    model: z.string().min(1),
    baseUrl: z.string().url().optional()
  }),
  hasApiKey: z.boolean()
});
export type SavedProviderSettings = z.infer<typeof SavedProviderSettingsSchema>;
```

Create `saveProviderSettings` with this behavior:

```ts
import type { LlmProviderName, SavedProviderSettings } from "@agentev4/shared";
import {
  ProviderSettingsInputSchema,
  SavedProviderSettingsSchema
} from "@agentev4/shared";
import type { KeyStore } from "@agentev4/core";

const REMOTE_PROVIDERS = new Set<LlmProviderName>([
  "anthropic", "openai", "gemini", "openrouter", "groq"
]);

export function saveProviderSettings(
  keyStore: KeyStore,
  input: unknown
): SavedProviderSettings {
  const parsed = ProviderSettingsInputSchema.parse(input);
  const apiKey = parsed.apiKey?.trim();
  const hasExistingKey = keyStore.has(parsed.provider);
  if (REMOTE_PROVIDERS.has(parsed.provider) && !apiKey && !hasExistingKey) {
    throw new Error("La API key es obligatoria para este proveedor.");
  }

  const config = {
    provider: parsed.provider,
    model: parsed.model,
    ...(parsed.baseUrl === "" ? {} : { baseUrl: parsed.baseUrl })
  };
  if (apiKey) keyStore.set(parsed.provider, apiKey);
  return SavedProviderSettingsSchema.parse({
    config,
    hasApiKey: Boolean(apiKey) || hasExistingKey
  });
}
```

In `server/src/index.ts`, add `providerSettings?: SavedProviderSettings["config"]` to state, a `saveProviderSettings` RPC handler, and make `sendPrompt` use the saved server config instead of provider/model/base URL supplied per prompt. Keep `apiKey: state.keyStore.get(config.provider)` local to the server.

- [ ] **Step 4: Run focused provider and existing security tests**

Run: `pnpm exec vitest run --project desktop server/src/provider-settings.test.ts && pnpm exec vitest run --project core src/security/key-store.test.ts src/providers.test.ts`

Expected: PASS with no secret printed in output.

- [ ] **Step 5: Commit the provider contract slice**

```bash
git add packages/shared/src/schemas/provider.ts apps/desktop/server/src/provider-settings.ts apps/desktop/server/src/provider-settings.test.ts apps/desktop/server/src/index.ts
git commit -m "feat(desktop): guardar configuración de proveedor"
```

---

### Task 2: Transactional Workspace Switching

**Files:**
- Create: `apps/desktop/server/src/workspace.ts`
- Create: `apps/desktop/server/src/workspace.test.ts`
- Modify: `apps/desktop/server/src/index.ts`

**Interfaces:**
- Consumes: `DatabaseHandle`, `SessionManager`, `openDatabase`.
- Produces: `WorkspaceState` and `switchWorkspace(state, workspacePath)`.

- [ ] **Step 1: Write failing real-filesystem tests**

```ts
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { switchWorkspace, type WorkspaceState } from "./workspace.js";

const cleanup: string[] = [];
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("switchWorkspace", () => {
  it("creates .agente and publishes the new state only after SQLite opens", async () => {
    const directory = await mkdtemp(join(tmpdir(), "agentev4-workspace-"));
    cleanup.push(directory);
    const state: WorkspaceState = {};

    const result = await switchWorkspace(state, directory);

    expect(result).toEqual({ workspacePath: directory, sessions: [] });
    expect(state.workspacePath).toBe(directory);
    expect(state.sessionManager?.listSessions()).toEqual([]);
    state.dbHandle?.close();
  });

  it("keeps the active workspace usable when a replacement path is invalid", async () => {
    const directory = await mkdtemp(join(tmpdir(), "agentev4-workspace-"));
    cleanup.push(directory);
    const invalidPath = join(directory, "not-a-directory.txt");
    await writeFile(invalidPath, "file", "utf8");
    const state: WorkspaceState = {};
    await switchWorkspace(state, directory);
    const originalManager = state.sessionManager;

    await expect(switchWorkspace(state, invalidPath)).rejects.toThrow("no es una carpeta");
    expect(state.workspacePath).toBe(directory);
    expect(state.sessionManager).toBe(originalManager);
    state.dbHandle?.close();
  });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `pnpm exec vitest run --project desktop server/src/workspace.test.ts`

Expected: FAIL because the extracted workspace service does not exist.

- [ ] **Step 3: Implement the transactional switch**

Create the state contract and transactional switch:

```ts
export interface WorkspaceState {
  workspacePath?: string;
  dbHandle?: DatabaseHandle;
  sessionManager?: SessionManager;
}

export async function switchWorkspace(state: WorkspaceState, rawPath: unknown) {
  if (typeof rawPath !== "string" || rawPath.trim() === "") {
    throw new Error("La ruta del workspace es obligatoria.");
  }
  const workspacePath = resolve(rawPath);
  const info = await stat(workspacePath);
  if (!info.isDirectory()) throw new Error(`La ruta "${workspacePath}" no es una carpeta.`);
  await mkdir(join(workspacePath, ".agente"), { recursive: true });

  const nextHandle = openDatabase(join(workspacePath, ".agente", "sessions.db"));
  let nextManager: SessionManager;
  let sessions: SessionConfig[];
  try {
    nextManager = new SessionManager(nextHandle.db);
    sessions = nextManager.listSessions();
  } catch (error) {
    nextHandle.close();
    throw error;
  }

  try {
    state.dbHandle?.close();
  } catch (error) {
    nextHandle.close();
    throw error;
  }
  state.workspacePath = workspacePath;
  state.dbHandle = nextHandle;
  state.sessionManager = nextManager;
  return { workspacePath, sessions };
}
```

Replace the old `initWorkspace` mutation in `server/src/index.ts` with this service.

- [ ] **Step 4: Run workspace and session tests**

Run: `pnpm exec vitest run --project desktop server/src/workspace.test.ts && pnpm exec vitest run --project core src/db/session-manager.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the workspace server slice**

```bash
git add apps/desktop/server/src/workspace.ts apps/desktop/server/src/workspace.test.ts apps/desktop/server/src/index.ts
git commit -m "fix(desktop): cambiar workspace de forma transaccional"
```

---

### Task 3: Resilient RPC Client and Minimum Tauri Capabilities

**Files:**
- Create: `apps/desktop/src/lib/rpc-client.ts`
- Create: `apps/desktop/src/lib/rpc-client.test.ts`
- Modify: `apps/desktop/src/lib/ipc.ts`
- Modify: `apps/desktop/src-tauri/capabilities/default.json`

**Interfaces:**
- Consumes: a `RpcProcessFactory` adapter around Tauri `Command`.
- Produces: `RpcClient.call<T>()` and `RpcClient.subscribe()`.

- [ ] **Step 1: Write failing lifecycle tests with a specific in-memory process fake**

The fake captures the full handlers passed to `start` and exposes `stdout`, `close`, and `error` events. Put this concrete fake in the test file before the test cases:

```ts
class FakeProcessFactory implements RpcProcessFactory {
  private handlers: RpcProcessHandlers | undefined;
  private startCount = 0;

  async start(handlers: RpcProcessHandlers): Promise<RpcWritableProcess> {
    this.handlers = handlers;
    this.startCount += 1;
    return {
      write: async () => undefined
    };
  }

  async started(expected = 1): Promise<void> {
    await vi.waitFor(() => expect(this.startCount).toBe(expected));
  }

  stdout(chunk: string): void {
    this.handlers?.stdout(chunk);
  }

  close(payload: { code: number | null; signal: number | null }): void {
    this.handlers?.close(payload);
  }

  error(message: string): void {
    this.handlers?.error(message);
  }
}
```

Tests assert consumer-visible promises rather than call counts on the fake:

```ts
it("resolves a response framed across stdout chunks", async () => {
  const factory = new FakeProcessFactory();
  const client = new RpcClient(factory, 1_000);
  const pending = client.call<string>("ping");
  await factory.started();
  factory.stdout('{"id":1,"result":"o');
  factory.stdout('k"}\n');
  await expect(pending).resolves.toBe("ok");
});

it("rejects pending requests on process close and restarts on the next call", async () => {
  const factory = new FakeProcessFactory();
  const client = new RpcClient(factory, 1_000);
  const first = client.call("first");
  await factory.started();
  factory.close({ code: 1, signal: null });
  await expect(first).rejects.toThrow("El servidor del agente se cerró");

  const second = client.call<string>("second");
  await factory.started(2);
  factory.stdout('{"id":2,"result":"restarted"}\n');
  await expect(second).resolves.toBe("restarted");
});

it("times out and removes a request that never receives a response", async () => {
  vi.useFakeTimers();
  const factory = new FakeProcessFactory();
  const client = new RpcClient(factory, 50);
  const pending = client.call("slow");
  await factory.started();
  await vi.advanceTimersByTimeAsync(50);
  await expect(pending).rejects.toThrow("Tiempo de espera agotado");
  vi.useRealTimers();
});
```

- [ ] **Step 2: Run the RPC tests and verify RED**

Run: `pnpm exec vitest run --project desktop src/lib/rpc-client.test.ts`

Expected: FAIL because `RpcClient` does not exist.

- [ ] **Step 3: Implement `RpcClient` and make `ipc.ts` a Tauri adapter**

Use these exact public contracts:

```ts
export interface RpcWritableProcess {
  write(data: string): Promise<void>;
}

export interface RpcProcessHandlers {
  stdout(chunk: string): void;
  stderr(chunk: string): void;
  close(payload: { code: number | null; signal: number | null }): void;
  error(message: string): void;
}

export interface RpcProcessFactory {
  start(handlers: RpcProcessHandlers): Promise<RpcWritableProcess>;
}

export class RpcClient {
  constructor(factory: RpcProcessFactory, timeoutMs = 30_000);
  call<T>(method: string, params?: Record<string, unknown>): Promise<T>;
  subscribe(listener: EventListener): () => void;
}
```

Each pending entry stores its timer. `close`, `error`, and failed `write` clear timers and reject all pending promises. Failed startup resets the cached startup promise. Late responses for timed-out IDs are ignored.

In `ipc.ts`, register `command.on("close")`, `command.on("error")`, `command.stdout.on("data")`, and `command.stderr.on("data")` before `spawn()`.

Change `default.json` permissions to:

```json
"permissions": [
  "core:default",
  "dialog:default",
  "shell:allow-stdin-write",
  {
    "identifier": "shell:allow-spawn",
    "allow": [{ "name": "node", "cmd": "node", "args": true }]
  }
]
```

- [ ] **Step 4: Verify RPC tests, TypeScript, and Tauri schema compilation**

Run: `pnpm exec vitest run --project desktop src/lib/rpc-client.test.ts && pnpm --filter @agentev4/desktop build`

Run from `apps/desktop/src-tauri`: `cargo check`

Expected: all commands exit 0.

- [ ] **Step 5: Commit the transport slice**

```bash
git add apps/desktop/src/lib/rpc-client.ts apps/desktop/src/lib/rpc-client.test.ts apps/desktop/src/lib/ipc.ts apps/desktop/src-tauri/capabilities/default.json
git commit -m "fix(desktop): recuperar el transporte RPC del sidecar"
```

---

### Task 4: Deterministic Workspace Preparation and Atomic Store Transition

**Files:**
- Create: `apps/desktop/src/lib/workspace.ts`
- Create: `apps/desktop/src/lib/workspace.test.ts`
- Modify: `apps/desktop/src/state/store.tsx`
- Modify: `apps/desktop/src/components/WorkspaceSelector.tsx`

**Interfaces:**
- Consumes: `callServer`, default `AgentMode`, default `PermissionMode`.
- Produces: `prepareWorkspace(input): Promise<ReadyWorkspace>` and `WORKSPACE_READY` action.

- [ ] **Step 1: Write failing orchestration tests**

Use these complete literal fixtures and method-dispatching fake before the test cases:

```ts
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
```

Then exercise the orchestration:

```ts
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
```

- [ ] **Step 2: Run workspace orchestration tests and verify RED**

Run: `pnpm exec vitest run --project desktop src/lib/workspace.test.ts`

Expected: FAIL because `prepareWorkspace` does not exist.

- [ ] **Step 3: Implement preparation and atomic reducer state**

Use these contracts:

```ts
export interface ReadyWorkspace {
  workspacePath: string;
  sessions: SessionConfig[];
  activeSessionId: string;
  messages: AgentMessage[];
  tools: string[];
}

export async function prepareWorkspace(input: {
  workspacePath: string;
  defaultMode: AgentMode;
  defaultPermissionMode: PermissionMode;
  call?: typeof callServer;
}): Promise<ReadyWorkspace>;
```

Sort sessions by descending `updatedAt`, then descending `createdAt`, then ascending `id`. When empty, call `createSession` with `{ name: "Sesión de prueba", mode, permissionMode }`. Load tools and messages before returning.

Replace `WORKSPACE_LOADED` with:

```ts
| { type: "WORKSPACE_SELECTION_STARTED" }
| { type: "WORKSPACE_SELECTION_CANCELLED" }
| { type: "WORKSPACE_PREPARING" }
| { type: "WORKSPACE_READY"; ready: ReadyWorkspace }
| { type: "WORKSPACE_PREPARATION_FAILED"; error: string }
```

Add `workspaceStatus: "idle" | "selecting" | "preparing" | "ready"` to state. `WORKSPACE_SELECTION_CANCELLED` returns to `ready` when a complete workspace/session already exists and otherwise returns to `idle`. `WORKSPACE_READY` updates workspace, sessions, active session, messages, tools, and clears old thoughts/tool calls/context/error in one reducer branch.

- [ ] **Step 4: Wire `WorkspaceSelector` and verify focused tests**

`WorkspaceSelector.handleSelect` dispatches `WORKSPACE_SELECTION_STARTED`, calls the dialog, dispatches `WORKSPACE_SELECTION_CANCELLED` on cancellation, dispatches `WORKSPACE_PREPARING` after receiving a path, calls `prepareWorkspace`, and dispatches exactly one `WORKSPACE_READY`. On failure it dispatches `WORKSPACE_PREPARATION_FAILED`.

Run: `pnpm exec vitest run --project desktop src/lib/workspace.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the workspace frontend slice**

```bash
git add apps/desktop/src/lib/workspace.ts apps/desktop/src/lib/workspace.test.ts apps/desktop/src/state/store.tsx apps/desktop/src/components/WorkspaceSelector.tsx
git commit -m "feat(desktop): preparar un chat al elegir workspace"
```

---

### Task 5: Global Feedback and Workspace-to-Chat UI

**Files:**
- Modify: `apps/desktop/package.json`
- Modify: `pnpm-lock.yaml`
- Create: `apps/desktop/src/components/GlobalFeedback.tsx`
- Create: `apps/desktop/src/components/workspace-flow.test.tsx`
- Modify: `apps/desktop/src/components/ChatPanel.tsx`
- Modify: `apps/desktop/src/App.tsx`

**Interfaces:**
- Consumes: global `state.error`, `state.notification`, `state.workspaceStatus`.
- Produces: accessible `role="status"` and `role="alert"` feedback independent of session state.

- [ ] **Step 1: Install DOM test-only dependencies**

Run: `pnpm --filter @agentev4/desktop add -D @testing-library/react @testing-library/user-event jsdom`

Expected: only `apps/desktop/package.json` and `pnpm-lock.yaml` change.

- [ ] **Step 2: Write failing user-level workspace tests**

Add `// @vitest-environment jsdom` and test the real provider, selector, feedback, and chat. Mock only the native dialog and the already-tested orchestration boundary.

```tsx
function readyWorkspaceFixture(): ReadyWorkspace {
  return {
    workspacePath: "C:\\repo",
    sessions: [
      {
        id: "session-1",
        name: "Sesión de prueba",
        workspacePath: "C:\\repo",
        mode: "agent",
        permissionMode: "default",
        status: "active",
        tokensUsed: 0,
        createdAt: new Date("2026-08-10T10:00:00.000Z"),
        updatedAt: new Date("2026-08-10T10:00:00.000Z")
      }
    ],
    activeSessionId: "session-1",
    messages: [],
    tools: []
  };
}

it("shows the chat after selecting a workspace", async () => {
  vi.mocked(selectWorkspaceFolder).mockResolvedValue("C:\\repo");
  vi.mocked(prepareWorkspace).mockResolvedValue(readyWorkspaceFixture());
  render(
    <AppStateProvider>
      <WorkspaceSelector />
      <ChatPanel />
      <GlobalFeedback />
    </AppStateProvider>
  );

  await userEvent.click(screen.getByRole("button", { name: /seleccionar carpeta/i }));
  expect(await screen.findByPlaceholderText("Escribe un prompt…")).not.toBeNull();
  expect(screen.getByText("C:\\repo")).not.toBeNull();
});

it("shows initialization errors even when no session exists", async () => {
  vi.mocked(selectWorkspaceFolder).mockResolvedValue("C:\\broken");
  vi.mocked(prepareWorkspace).mockRejectedValue(new Error("No se pudo iniciar el sidecar"));
  render(
    <AppStateProvider>
      <WorkspaceSelector />
      <ChatPanel />
      <GlobalFeedback />
    </AppStateProvider>
  );

  await userEvent.click(screen.getByRole("button", { name: /seleccionar carpeta/i }));
  expect((await screen.findByRole("alert")).textContent).toContain("No se pudo iniciar el sidecar");
});
```

- [ ] **Step 3: Run the component test and verify RED**

Run: `pnpm exec vitest run --project desktop src/components/workspace-flow.test.tsx`

Expected: FAIL because `GlobalFeedback` and the new state branches are not rendered.

- [ ] **Step 4: Implement global feedback and explicit chat states**

Add notification state:

```ts
export interface AppNotification {
  id: string;
  kind: "success";
  message: string;
}
```

Add actions `NOTIFICATION_SET`, `NOTIFICATION_CLEAR`, and `ERROR_CLEAR`. `GlobalFeedback` renders fixed top-right feedback, clears success after 3 seconds, leaves errors visible until closed, and uses buttons with accessible labels.

`ChatPanel` must render:

- `Selecciona una carpeta para preparar el agente.` while idle.
- `Seleccionando carpeta…` while the native dialog is open.
- `Preparando workspace y sesión…` while preparing.
- `Selecciona o crea una sesión para empezar.` only for a ready workspace without an active session.
- The textarea with `autoFocus` once ready.

Mount `<GlobalFeedback />` once in `App`, outside `SettingsPanel`, `ChatPanel`, and `PermissionModal`.

- [ ] **Step 5: Run component tests and build**

Run: `pnpm exec vitest run --project desktop src/components/workspace-flow.test.tsx && pnpm --filter @agentev4/desktop build`

Expected: PASS.

- [ ] **Step 6: Commit the feedback/chat slice**

```bash
git add apps/desktop/package.json pnpm-lock.yaml apps/desktop/src/components/GlobalFeedback.tsx apps/desktop/src/components/workspace-flow.test.tsx apps/desktop/src/components/ChatPanel.tsx apps/desktop/src/App.tsx apps/desktop/src/state/store.tsx
git commit -m "feat(desktop): mostrar el chat y feedback global"
```

---

### Task 6: Atomic Settings Form and Success Popup

**Files:**
- Create: `apps/desktop/src/components/settings-flow.test.tsx`
- Modify: `apps/desktop/src/components/SettingsPanel.tsx`
- Modify: `apps/desktop/src/components/ChatPanel.tsx`
- Modify: `apps/desktop/src/state/store.tsx`
- Modify: `apps/desktop/server/src/index.ts`

**Interfaces:**
- Consumes: `saveProviderSettings` RPC and `SavedProviderSettings`.
- Produces: committed `providerConfig` state and global success notification.

- [ ] **Step 1: Write failing save-flow tests**

Mock only `callServer`, the process boundary. Return complete responses by method.

```tsx
function OpenSettings(): React.ReactElement {
  const { dispatch } = useAppState();
  useEffect(() => dispatch({ type: "SETTINGS_TOGGLE" }), [dispatch]);
  return (
    <>
      <SettingsPanel />
      <GlobalFeedback />
    </>
  );
}

function SettingsHarness(): React.ReactElement {
  return (
    <AppStateProvider>
      <OpenSettings />
    </AppStateProvider>
  );
}

it("commits provider settings and shows success only after the server confirms", async () => {
  vi.mocked(callServer).mockImplementation(async (method) => {
    if (method === "hasApiKey") return { hasKey: false };
    if (method === "saveProviderSettings") {
      return {
        config: { provider: "openai", model: "gpt-5" },
        hasApiKey: true
      };
    }
    throw new Error(`Unexpected method: ${method}`);
  });

  render(<SettingsHarness />);
  await userEvent.selectOptions(screen.getByLabelText("Proveedor"), "openai");
  await userEvent.clear(screen.getByLabelText("Modelo"));
  await userEvent.type(screen.getByLabelText("Modelo"), "gpt-5");
  await userEvent.type(screen.getByLabelText("API key"), "sk-secret");
  await userEvent.click(screen.getByRole("button", { name: "Guardar configuración" }));

  expect((await screen.findByRole("status")).textContent).toContain(
    "Configuración guardada correctamente"
  );
  expect((screen.getByLabelText("API key") as HTMLInputElement).value).toBe("");
});

it("keeps the draft and does not show success when saving fails", async () => {
  vi.mocked(callServer).mockImplementation(async (method) => {
    if (method === "hasApiKey") return { hasKey: false };
    throw new Error("La API key es obligatoria para este proveedor.");
  });

  render(<SettingsHarness />);
  await userEvent.clear(screen.getByLabelText("Modelo"));
  await userEvent.type(screen.getByLabelText("Modelo"), "model-under-test");
  await userEvent.click(screen.getByRole("button", { name: "Guardar configuración" }));

  expect((await screen.findByRole("alert")).textContent).toContain("La API key es obligatoria");
  expect((screen.getByLabelText("Modelo") as HTMLInputElement).value).toBe("model-under-test");
  expect(screen.queryByText("Configuración guardada correctamente")).toBeNull();
});
```

- [ ] **Step 2: Run settings test and verify RED**

Run: `pnpm exec vitest run --project desktop src/components/settings-flow.test.tsx`

Expected: FAIL because provider/model currently mutate global state immediately and the save button only stores a key.

- [ ] **Step 3: Implement the draft and atomic save**

Use a single local draft:

```ts
interface ProviderDraft {
  provider: LlmProviderName;
  model: string;
  baseUrl: string;
  apiKey: string;
}
```

Replace the merging provider action with an exact committed action:

```ts
| { type: "PROVIDER_CONFIG_COMMITTED"; config: ProviderConfig }

case "PROVIDER_CONFIG_COMMITTED":
  return { ...state, providerConfig: action.config };
```

Initialize it from committed `state.providerConfig` whenever the closed panel opens. Add explicit labels linked with `htmlFor`. `handleSave` must:

1. Reject an empty trimmed model locally.
2. Set `saving=true` and clear the previous global error.
3. Call `saveProviderSettings` with provider, trimmed model, trimmed base URL, and `apiKey` only when non-empty.
4. Dispatch `PROVIDER_CONFIG_COMMITTED` with `{ ...result.config, baseUrl: result.config.baseUrl ?? "" }`; this replaces the complete committed config so clearing a previously saved URL cannot retain stale state.
5. Clear the API-key draft and set `hasKey=result.hasApiKey`.
6. Dispatch `NOTIFICATION_SET` with `Configuración guardada correctamente`.
7. On failure dispatch `ERROR_SET` without closing or resetting the draft.
8. Restore `saving=false` in `finally`.

Change the button label to `Guardando…` during the request and disable all provider fields and the button.

Remove provider/model/base URL from `ChatPanel.sendPrompt`; the server now uses its committed in-memory provider settings.

- [ ] **Step 4: Run settings, workspace, provider, and chat-focused tests**

Run: `pnpm exec vitest run --project desktop src/components/settings-flow.test.tsx src/components/workspace-flow.test.tsx server/src/provider-settings.test.ts`

Expected: PASS with no API key in snapshots or output.

- [ ] **Step 5: Commit the settings slice**

```bash
git add apps/desktop/src/components/settings-flow.test.tsx apps/desktop/src/components/SettingsPanel.tsx apps/desktop/src/components/ChatPanel.tsx apps/desktop/src/state/store.tsx apps/desktop/server/src/index.ts
git commit -m "feat(desktop): confirmar el guardado de ajustes"
```

---

### Task 7: Cross-Axis Review and End-to-End Verification

**Files:**
- Modify if behavior changed: `README.md`
- Review: every file changed in Tasks 1–6

**Interfaces:**
- Consumes: all previous task outputs.
- Produces: verified workspace-to-chat and settings-save user stories.

- [ ] **Step 1: Run formatting only on changed implementation files**

Run: `pnpm exec prettier --write packages/shared/src/schemas/provider.ts apps/desktop/server/src apps/desktop/src apps/desktop/src-tauri/capabilities/default.json`

Expected: no unrelated file changes.

- [ ] **Step 2: Run all non-Docker automated tests**

Run: `pnpm exec vitest run --exclude "packages/tools/src/docker/ephemeral-exec.test.ts"`

Expected: all selected test files pass with zero failures.

- [ ] **Step 3: Run static verification**

Run: `pnpm lint`

Run: `pnpm build`

Run: `pnpm --filter @agentev4/desktop build`

Run from `apps/desktop/src-tauri`: `cargo check`

Expected: every command exits 0.

- [ ] **Step 4: Run the complete test command and classify Docker evidence honestly**

Run: `pnpm test`

Expected in a Docker-enabled environment: all tests pass. If Docker access is denied, record the exact three environment-dependent failures and do not claim the full suite is green.

- [ ] **Step 5: Perform the manual Tauri scenario**

Run: `pnpm tauri dev`

Verify in order:

1. Canceling the folder dialog leaves the current state unchanged.
2. Selecting a fresh writable folder creates `.agente/sessions.db`, activates one `Sesión de prueba`, and focuses the prompt field.
3. Selecting the same folder again activates the existing session without creating another.
4. Saving a remote provider without a key shows an error and preserves the draft.
5. Saving provider, model, and key shows `Configuración guardada correctamente`.
6. Sending a prompt reaches the server using the saved provider settings.
7. Closing or crashing the sidecar surfaces an error, and a subsequent action restarts it.

- [ ] **Step 6: Review the five quality axes**

- Correctness: no partial workspace state, duplicate automatic session, false success popup, or stale provider draft.
- Readability: `ipc.ts`, workspace orchestration, server validation, and React presentation each have one responsibility.
- Architecture: frontend does not import `core`/`tools`; shared schemas remain the cross-boundary source of truth.
- Security: capabilities are restricted to declared Node spawn/stdin, and API keys never cross back from the server.
- Performance: one workspace initialization, one message load, bounded notification timer, and no repeated session polling.

- [ ] **Step 7: Inspect the final diff and commit verification documentation if needed**

Run: `git diff --check`

Run: `git status --short`

If README behavior changed, commit only that documentation:

```bash
git add README.md
git commit -m "docs: documentar preparación automática del chat"
```
