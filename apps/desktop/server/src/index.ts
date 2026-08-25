import { randomUUID } from "node:crypto";
import { InitWorkspaceInputSchema } from "@agentev4/shared";
import type {
  AgentIpcEvent,
  AgentInterface,
  AgentMode,
  InitWorkspaceInput,
  LlmProviderConfig,
  LlmProviderName,
  PermissionMode,
  SavedProviderSettings,
  ToolCall
} from "@agentev4/shared";
import {
  KeyStore,
  type CanUseTool,
  type PermissionDecision,
  PermissionEngine,
  SessionManager,
  countContextTokens,
  createMastraAgentFactory,
  createResilientAgent,
  runAgenticLoop
} from "@agentev4/core";
import { createStaticToolRegistry, executeRegisteredTool, toToolDeclarations, type McpConnection, type ToolRegistry } from "@agentev4/tools";
import { closeMcpConnections, connectConfiguredMcpServers } from "./mcp-tools.js";
import { saveProviderSettings } from "./provider-settings.js";
import { encodeLine, isRpcRequest, parseLines, type RpcRequest } from "./protocol.js";
import { switchWorkspace, type WorkspaceState } from "./workspace.js";

const SYSTEM_PROMPT = "You are Agentev4, an autonomous coding agent.";
// ponytail: sin tabla de límites por modelo todavía; sube a un lookup real
// (proveedor+modelo -> max context) si el gauge necesita precisión por modelo.
const MAX_CONTEXT_TOKENS = 200_000;
const DEFAULT_GOVERNANCE = { maxTurns: 8, maxBudgetUsd: 1, effortLevel: "medium" as const };

interface ServerState extends WorkspaceState {
  providerSettings?: SavedProviderSettings["config"];
  readonly keyStore: KeyStore;
  readonly pendingPermissions: Map<string, (decision: PermissionDecision) => void>;
  toolRegistry: ToolRegistry;
  mcpConnections: McpConnection[];
}

const state: ServerState = {
  keyStore: new KeyStore(),
  pendingPermissions: new Map(),
  toolRegistry: createStaticToolRegistry(),
  mcpConnections: []
};
const activePrompts = new Set<string>();
let workspaceTransitionInProgress = false;

function assertNoActivePrompts(): void {
  if (activePrompts.size > 0) {
    throw new Error("Hay un prompt activo; espera a que termine antes de cambiar de workspace.");
  }
}

function assertNoWorkspaceTransition(): void {
  if (workspaceTransitionInProgress) {
    throw new Error("Hay un cambio de workspace en curso; espera a que termine.");
  }
}

function assertSessionMutationAllowed(): void {
  assertNoWorkspaceTransition();
  assertNoActivePrompts();
}

function requireSessionManager(): SessionManager {
  if (!state.sessionManager)
    throw new Error("Ningún workspace inicializado todavía (llama a initWorkspace primero).");
  return state.sessionManager;
}

function requireWorkspacePath(): string {
  if (!state.workspacePath)
    throw new Error("Ningún workspace inicializado todavía (llama a initWorkspace primero).");
  return state.workspacePath;
}

async function initWorkspace(input: Record<string, unknown> | undefined) {
  const params: InitWorkspaceInput = InitWorkspaceInputSchema.parse(input);
  assertNoActivePrompts();
  assertNoWorkspaceTransition();
  workspaceTransitionInProgress = true;
  try {
    const ready = await switchWorkspace(state, params.workspacePath, {
      defaultMode: params.defaultMode,
      defaultPermissionMode: params.defaultPermissionMode,
      listTools: () => Object.keys(createStaticToolRegistry()),
      beforeCommit: assertNoActivePrompts
    });

    // Las tools MCP se conectan tras confirmar el workspace (necesitan
    // `.agente/mcp.json` ya resuelto) y se cierran las del workspace
    // anterior para no dejar procesos hijo huérfanos.
    const previousMcpConnections = state.mcpConnections;
    const { registry, connections } = await connectConfiguredMcpServers(ready.workspacePath);
    await closeMcpConnections(previousMcpConnections);
    state.toolRegistry = registry;
    state.mcpConnections = connections;

    return { ...ready, tools: Object.keys(registry) };
  } finally {
    workspaceTransitionInProgress = false;
  }
}

/**
 * Envuelve el `AgentInterface` resiliente para emitir `agent:context_update`
 * al terminar cada turno LLM (antes se calculaba una sola vez, al final de
 * todo el bucle multi-turno, así que el gauge de contexto no se movía
 * durante la ejecución). No toca `input.onDelta`: el streaming token a
 * token lo cablea directamente `runAgenticLoop` vía `AgentLoopParams.onDelta`.
 */
function withContextUpdateEvents(
  agent: AgentInterface,
  sessionId: string,
  registry: ToolRegistry,
  emit: (event: AgentIpcEvent) => void
): AgentInterface {
  return {
    async run(input) {
      const result = await agent.run(input);

      const breakdown = countContextTokens({
        systemPrompt: SYSTEM_PROMPT,
        rules: "",
        tools: Object.keys(registry).join(","),
        messages: [...input.messages, result.message]
      });
      emit({
        type: "agent:context_update",
        sessionId,
        usedTokens: breakdown.total,
        maxTokens: MAX_CONTEXT_TOKENS,
        breakdown
      });

      return result;
    },
    submitToolResult: (result) => agent.submitToolResult(result)
  };
}

/** Puente HITL (Fase 3 canUseTool -> Fase 11 modal): pausa hasta que llegue respondPermission. */
function bridgedCanUseTool(sessionId: string, emit: (event: AgentIpcEvent) => void): CanUseTool {
  return (call: ToolCall) =>
    new Promise((resolve) => {
      const requestId = randomUUID();
      state.pendingPermissions.set(requestId, resolve);
      emit({ type: "agent:permission_request", sessionId, requestId, toolCall: call });
    });
}

async function executePrompt(
  params: {
    sessionId: string;
    prompt: string;
    disabledTools?: string[];
  },
  emit: (event: AgentIpcEvent) => void
) {
  const sessionManager = requireSessionManager();
  const session = sessionManager.getSession(params.sessionId);
  if (!session) throw new Error(`Sesión "${params.sessionId}" no existe.`);

  const config = state.providerSettings;
  if (!config) throw new Error("No hay configuración de proveedor guardada todavía.");

  sessionManager.appendMessage(params.sessionId, { role: "user", content: params.prompt });

  const providerConfig: LlmProviderConfig = {
    ...config,
    apiKey: state.keyStore.get(config.provider)
  };
  const registry = state.toolRegistry;
  const agent = withContextUpdateEvents(
    createResilientAgent(
      createMastraAgentFactory().create(providerConfig, toToolDeclarations(registry)),
      undefined
    ),
    params.sessionId,
    registry,
    emit
  );

  const permissionEngine = new PermissionEngine({
    mode: session.permissionMode,
    canUseTool: bridgedCanUseTool(params.sessionId, emit),
    rules: { deny: params.disabledTools ?? [] }
  });
  const executeTool = async (call: ToolCall) => {
    const decision = await permissionEngine.evaluate(call);
    if (decision.behavior === "deny") {
      const result = { toolCallId: call.id, output: decision.message, isError: true };
      sessionManager.recordToolExecution(params.sessionId, call, result);
      return result;
    }
    const effectiveCall = decision.updatedInput ? { ...call, input: decision.updatedInput } : call;
    emit({ type: "agent:tool_call", sessionId: params.sessionId, toolCall: effectiveCall });
    const result = await executeRegisteredTool(registry, effectiveCall);
    sessionManager.recordToolExecution(params.sessionId, call, result);
    return result;
  };

  const priorMessages = sessionManager.listMessages(params.sessionId);
  const result = await runAgenticLoop({
    agent,
    mode: session.mode,
    messages: priorMessages,
    governance: DEFAULT_GOVERNANCE,
    executeTool,
    onDelta: (delta, messageId) =>
      emit({ type: "agent:message_delta", sessionId: params.sessionId, messageId, delta })
  });

  for (const message of result.messages.slice(priorMessages.length)) {
    sessionManager.appendMessage(params.sessionId, message);
  }

  return { haltReason: result.haltReason, turnsUsed: result.turnsUsed };
}

async function sendPrompt(
  params: {
    sessionId: string;
    prompt: string;
    disabledTools?: string[];
  },
  emit: (event: AgentIpcEvent) => void
) {
  assertNoWorkspaceTransition();
  if (activePrompts.has(params.sessionId)) {
    throw new Error(`La sesión "${params.sessionId}" ya tiene un prompt activo.`);
  }

  activePrompts.add(params.sessionId);
  try {
    return await executePrompt(params, emit);
  } finally {
    activePrompts.delete(params.sessionId);
  }
}

type Handler = (
  params: Record<string, unknown> | undefined,
  emit: (event: AgentIpcEvent) => void
) => Promise<unknown>;

function cast<T>(params: Record<string, unknown> | undefined): T {
  return params as T;
}

export const handlers: Record<string, Handler> = {
  initWorkspace: (p) => initWorkspace(p),
  listSessions: async () => requireSessionManager().listSessions(),
  listMessages: async (p) =>
    requireSessionManager().listMessages(cast<{ sessionId: string }>(p).sessionId),
  listTools: async () => Object.keys(state.toolRegistry),
  createSession: async (p) => {
    assertSessionMutationAllowed();
    const { name, mode, permissionMode } = cast<{
      name: string;
      mode: AgentMode;
      permissionMode: PermissionMode;
    }>(p);
    return requireSessionManager().createSession({
      name,
      mode,
      permissionMode,
      workspacePath: requireWorkspacePath()
    });
  },
  renameSession: async (p) => {
    assertSessionMutationAllowed();
    const { sessionId, name } = cast<{ sessionId: string; name: string }>(p);
    return requireSessionManager().renameSession(sessionId, name);
  },
  deleteSession: async (p) => {
    assertSessionMutationAllowed();
    requireSessionManager().deleteSession(cast<{ sessionId: string }>(p).sessionId);
    return { ok: true };
  },
  listCheckpoints: async (p) =>
    requireSessionManager().listCheckpoints(cast<{ sessionId: string }>(p).sessionId),
  restoreCheckpoint: async (p) => {
    assertSessionMutationAllowed();
    const { sessionId, checkpointId } = cast<{ sessionId: string; checkpointId: string }>(p);
    return requireSessionManager().restoreCheckpoint(sessionId, checkpointId);
  },
  setApiKey: async (p) => {
    const { provider, apiKey } = cast<{ provider: LlmProviderName; apiKey: string }>(p);
    state.keyStore.set(provider, apiKey);
    return { ok: true };
  },
  hasApiKey: async (p) => ({
    hasKey: state.keyStore.has(cast<{ provider: LlmProviderName }>(p).provider)
  }),
  saveProviderSettings: async (p) => {
    const saved = saveProviderSettings(state.keyStore, p);
    state.providerSettings = saved.config;
    return saved;
  },
  respondPermission: async (p) => {
    const { requestId, decision } = cast<{ requestId: string; decision: PermissionDecision }>(p);
    const resolve = state.pendingPermissions.get(requestId);
    if (!resolve)
      throw new Error(`No hay una solicitud de permiso pendiente con id "${requestId}".`);
    state.pendingPermissions.delete(requestId);
    resolve(decision);
    return { ok: true };
  },
  sendPrompt: (p, emit) =>
    sendPrompt(
      cast<{
        sessionId: string;
        prompt: string;
        disabledTools?: string[];
      }>(p),
      emit
    )
};

function emit(event: AgentIpcEvent): void {
  process.stdout.write(encodeLine(event));
}

async function dispatch(request: RpcRequest): Promise<void> {
  const handler = handlers[request.method];
  try {
    if (!handler) throw new Error(`Método RPC desconocido: "${request.method}"`);
    const result = await handler(request.params, emit);
    process.stdout.write(encodeLine({ id: request.id, result }));
  } catch (error) {
    // Nunca se registran `params` aquí (Fase 10 DoD): un error de setApiKey no
    // debe poder filtrar la clave adjunta a través de este log.
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[agent-server] error en "${request.method}": ${message}\n`);
    process.stdout.write(encodeLine({ id: request.id, error: message }));
  }
}

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk: string) => {
  const { messages, rest } = parseLines(buffer + chunk);
  buffer = rest;
  for (const message of messages) {
    if (isRpcRequest(message)) void dispatch(message);
  }
});
process.stdin.on("end", () => {
  void closeMcpConnections(state.mcpConnections).finally(() => process.exit(0));
});
