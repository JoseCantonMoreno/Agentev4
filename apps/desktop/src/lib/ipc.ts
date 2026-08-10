import { Command, type Child } from "@tauri-apps/plugin-shell";
import type { AgentIpcEvent } from "@agentev4/shared";

type EventListener = (event: AgentIpcEvent) => void;

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
}

// ponytail: ruta relativa al cwd por defecto de un proceso Tauri en `tauri
// dev` (la carpeta `src-tauri`). Solo válida en dev — el empaquetado
// (`tauri build`) está explícitamente pospuesto (Fase 11), así que la
// resolución de ruta para un sidecar embebido queda para cuando llegue esa fase.
const SERVER_ENTRY = "../server/dist/index.js";

let child: Child | undefined;
let spawnPromise: Promise<Child> | undefined;
let nextId = 1;
let buffer = "";
const pending = new Map<number, PendingRequest>();
const listeners = new Set<EventListener>();

function isAgentIpcEvent(value: unknown): value is AgentIpcEvent {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { type?: unknown }).type === "string" &&
    (value as { type: string }).type.startsWith("agent:")
  );
}

function handleLine(line: string): void {
  if (line.trim().length === 0) return;

  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return;
  }

  if (isAgentIpcEvent(parsed)) {
    for (const listener of listeners) listener(parsed);
    return;
  }

  const { id, result, error } = parsed as { id?: number; result?: unknown; error?: string };
  if (typeof id !== "number") return;
  const request = pending.get(id);
  if (!request) return;
  pending.delete(id);
  if (error) request.reject(new Error(error));
  else request.resolve(result);
}

async function ensureServer(): Promise<Child> {
  if (child) return child;
  spawnPromise ??= (async () => {
    const command = Command.create("node", [SERVER_ENTRY]);
    command.stdout.on("data", (chunk: string) => {
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) handleLine(line);
    });
    command.stderr.on("data", (chunk: string) => {
      console.error("[agent-server]", chunk);
    });
    const spawned = await command.spawn();
    child = spawned;
    return spawned;
  })();
  return spawnPromise;
}

/** Invoca un método del agent-server (JSON-RPC por stdio) y espera su respuesta. */
export async function callServer<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> {
  const process = await ensureServer();
  const id = nextId++;

  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
    void process.write(`${JSON.stringify({ id, method, params })}\n`).catch((writeError: unknown) => {
      pending.delete(id);
      reject(writeError instanceof Error ? writeError : new Error(String(writeError)));
    });
  });
}

/** Suscribe a los eventos `agent:*` emitidos por el sidecar. Devuelve una función para desuscribirse. */
export function onServerEvent(listener: EventListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
