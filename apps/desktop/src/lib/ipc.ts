import { Command } from "@tauri-apps/plugin-shell";
import type { AgentIpcEvent } from "@agentev4/shared";
import {
  RpcClient,
  type RpcProcessFactory,
  type RpcProcessHandlers,
  type RpcWritableProcess
} from "./rpc-client";

type EventListener = (event: AgentIpcEvent) => void;

// ponytail: ruta relativa al cwd por defecto de un proceso Tauri en `tauri
// dev` (la carpeta `src-tauri`). Solo válida en dev — el empaquetado
// (`tauri build`) está explícitamente pospuesto (Fase 11), así que la
// resolución de ruta para un sidecar embebido queda para cuando llegue esa fase.
const SERVER_ENTRY = "../server/dist/index.js";

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

const client = new RpcClient(new TauriRpcProcessFactory());

/** Invoca un método del agent-server (JSON-RPC por stdio) y espera su respuesta. */
export async function callServer<T = unknown>(
  method: string,
  params?: Record<string, unknown>
): Promise<T> {
  return client.call<T>(method, params);
}

/** Suscribe a los eventos `agent:*` emitidos por el sidecar. Devuelve una función para desuscribirse. */
export function onServerEvent(listener: EventListener): () => void {
  return client.subscribe(listener);
}
