import { Command } from "@tauri-apps/plugin-shell";
import {
  AgentMessageSchema,
  SavedProviderSettingsSchema,
  SessionConfigSchema,
  type AgentIpcEvent,
  type AgentMessage,
  type SavedProviderSettings,
  type SessionConfig
} from "@agentev4/shared";
import {
  RpcClient,
  type RpcCallOptions,
  type RpcLifecycleEvent,
  type RpcProcessFactory,
  type RpcProcessHandlers,
  type RpcWritableProcess
} from "./rpc-client";

type EventListener = (event: AgentIpcEvent) => void;
type LifecycleListener = (event: RpcLifecycleEvent) => void;
type Validator = (value: unknown) => unknown;

interface ReadyWorkspaceResult {
  workspacePath: string;
  sessions: SessionConfig[];
  activeSessionId: string;
  messages: AgentMessage[];
  tools: string[];
}

interface RpcResultMap {
  initWorkspace: ReadyWorkspaceResult;
  listSessions: SessionConfig[];
  listMessages: AgentMessage[];
  listTools: string[];
  createSession: SessionConfig;
  renameSession: SessionConfig;
  deleteSession: { ok: true };
  listCheckpoints: string[];
  restoreCheckpoint: Record<string, unknown>;
  setApiKey: { ok: true };
  hasApiKey: { hasKey: boolean };
  saveProviderSettings: SavedProviderSettings;
  respondPermission: { ok: true };
  sendPrompt: { haltReason: string; turnsUsed: number };
}

export type RpcMethod = keyof RpcResultMap;

const SERVER_ENTRY = "../server/dist/index.js";
const READ_TIMEOUT_MS = 30_000;
const NON_EXPIRING_METHODS = new Set([
  "sendPrompt",
  "initWorkspace",
  "createSession",
  "renameSession",
  "deleteSession",
  "restoreCheckpoint",
  "saveProviderSettings",
  "setApiKey",
  "respondPermission"
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseStringArray(value: unknown): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) throw new Error();
  return value;
}

function parseOk(value: unknown): { ok: true } {
  if (!isRecord(value) || value.ok !== true) throw new Error();
  return { ok: true };
}

function parseHasKey(value: unknown): { hasKey: boolean } {
  if (!isRecord(value) || typeof value.hasKey !== "boolean") throw new Error();
  return { hasKey: value.hasKey };
}

function parseReadyWorkspace(value: unknown): unknown {
  if (!isRecord(value)) throw new Error();
  if (typeof value.workspacePath !== "string" || typeof value.activeSessionId !== "string") {
    throw new Error();
  }
  return {
    ...value,
    sessions: SessionConfigSchema.array().parse(value.sessions),
    messages: AgentMessageSchema.array().parse(value.messages),
    tools: parseStringArray(value.tools)
  };
}

function parsePromptResult(value: unknown): unknown {
  if (
    !isRecord(value) ||
    typeof value.haltReason !== "string" ||
    typeof value.turnsUsed !== "number" ||
    !Number.isInteger(value.turnsUsed) ||
    value.turnsUsed < 0
  ) {
    throw new Error();
  }
  return { haltReason: value.haltReason, turnsUsed: value.turnsUsed };
}

function parseRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new Error();
  return value;
}

function parseSavedProviderSettings(value: unknown): unknown {
  if (
    !isRecord(value) ||
    "apiKey" in value ||
    (isRecord(value.config) && "apiKey" in value.config)
  ) {
    throw new Error();
  }
  return SavedProviderSettingsSchema.parse(value);
}

const RESULT_VALIDATORS: Record<string, Validator> = {
  initWorkspace: parseReadyWorkspace,
  listSessions: (value) => SessionConfigSchema.array().parse(value),
  listMessages: (value) => AgentMessageSchema.array().parse(value),
  listTools: parseStringArray,
  createSession: (value) => SessionConfigSchema.parse(value),
  renameSession: (value) => SessionConfigSchema.parse(value),
  deleteSession: parseOk,
  listCheckpoints: parseStringArray,
  restoreCheckpoint: parseRecord,
  setApiKey: parseOk,
  hasApiKey: parseHasKey,
  saveProviderSettings: parseSavedProviderSettings,
  respondPermission: parseOk,
  sendPrompt: parsePromptResult
};

export function rpcPolicyForMethod(method: string): Required<RpcCallOptions> {
  return { timeoutMs: NON_EXPIRING_METHODS.has(method) ? false : READ_TIMEOUT_MS };
}

function containsApiKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsApiKey);
  if (!isRecord(value)) return false;
  return Object.entries(value).some(
    ([key, nested]) => key.toLowerCase() === "apikey" || containsApiKey(nested)
  );
}

export function validateRpcResult<M extends RpcMethod>(method: M, value: unknown): RpcResultMap[M] {
  const validator = RESULT_VALIDATORS[method];
  try {
    if (containsApiKey(value)) throw new Error();
    return validator!(value) as RpcResultMap[M];
  } catch {
    throw new Error(`Respuesta RPC inv\u00e1lida para ${method}`);
  }
}

class TauriRpcProcessFactory implements RpcProcessFactory {
  async start(handlers: RpcProcessHandlers): Promise<RpcWritableProcess> {
    const command = Command.create("node", [SERVER_ENTRY]);
    command.on("close", handlers.close);
    command.on("error", (error) => handlers.error(String(error)));
    command.stdout.on("data", handlers.stdout);
    command.stderr.on("data", (chunk: string) => {
      handlers.stderr(chunk);
      console.error("[agent-server]", chunk);
    });
    const child = await command.spawn();
    return { write: (data) => child.write(data) };
  }
}

const client = new RpcClient(new TauriRpcProcessFactory(), READ_TIMEOUT_MS);

/** Invoca un metodo soportado, aplica su politica temporal y valida la respuesta. */
export async function callServer<M extends RpcMethod>(
  method: M,
  params?: Record<string, unknown>
): Promise<RpcResultMap[M]> {
  const result = await client.call<unknown>(method, params, rpcPolicyForMethod(method));
  return validateRpcResult(method, result);
}

export function onServerEvent(listener: EventListener): () => void {
  return client.subscribe(listener);
}

export function onServerLifecycle(listener: LifecycleListener): () => void {
  return client.subscribeLifecycle(listener);
}
