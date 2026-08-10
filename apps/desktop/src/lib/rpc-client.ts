import type { AgentIpcEvent } from "@agentev4/shared";

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

export type EventListener = (event: AgentIpcEvent) => void;

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

function isAgentIpcEvent(value: unknown): value is AgentIpcEvent {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { type?: unknown }).type === "string" &&
    (value as { type: string }).type.startsWith("agent:")
  );
}

function toError(value: unknown, fallback: string): Error {
  if (value instanceof Error) return value;
  if (typeof value === "string" && value.length > 0) return new Error(value);
  return new Error(fallback);
}

export class RpcClient {
  private readonly pending = new Map<number, PendingRequest>();
  private readonly listeners = new Set<EventListener>();
  private nextId = 1;
  private buffer = "";
  private process: RpcWritableProcess | undefined;
  private processGeneration = 0;
  private startPromise: Promise<RpcWritableProcess> | undefined;
  private generation = 0;

  constructor(
    private readonly factory: RpcProcessFactory,
    private readonly timeoutMs = 30_000
  ) {}

  call<T>(method: string, params?: Record<string, unknown>): Promise<T> {
    return this.ensureProcess().then(
      (process) => this.writeRequest<T>(process, method, params),
      (error: unknown) =>
        Promise.reject(toError(error, "No se pudo iniciar el servidor del agente"))
    );
  }

  subscribe(listener: EventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private ensureProcess(): Promise<RpcWritableProcess> {
    if (this.process) return Promise.resolve(this.process);
    if (this.startPromise) return this.startPromise;

    const generation = ++this.generation;
    const startup = this.factory.start({
      stdout: (chunk) => this.handleStdout(generation, chunk),
      stderr: () => undefined,
      close: () => this.stop(generation, new Error("El servidor del agente se cerró")),
      error: (message) => this.stop(generation, toError(message, "El servidor del agente falló"))
    });
    const startPromise = startup.then((process) => {
      if (this.generation !== generation) {
        throw new Error("El servidor del agente se cerró");
      }
      this.process = process;
      this.processGeneration = generation;
      return process;
    });

    this.startPromise = startPromise;
    void startPromise.catch(() => {
      if (this.startPromise === startPromise) this.startPromise = undefined;
    });
    return startPromise;
  }

  private writeRequest<T>(
    process: RpcWritableProcess,
    method: string,
    params: Record<string, unknown> | undefined
  ): Promise<T> {
    if (this.process !== process) {
      return Promise.reject(new Error("El servidor del agente se cerró"));
    }

    const generation = this.processGeneration;
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        const request = this.pending.get(id);
        if (!request) return;
        this.pending.delete(id);
        request.reject(new Error("Tiempo de espera agotado"));
      }, this.timeoutMs);

      this.pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timeout
      });

      void process.write(`${JSON.stringify({ id, method, params })}\n`).catch((error: unknown) => {
        this.stop(generation, toError(error, "No se pudo escribir al servidor del agente"));
      });
    });
  }

  private handleStdout(generation: number, chunk: string): void {
    if (this.generation !== generation) return;

    this.buffer += chunk;
    let lineEnd = this.buffer.indexOf("\n");
    while (lineEnd >= 0) {
      const line = this.buffer.slice(0, lineEnd);
      this.buffer = this.buffer.slice(lineEnd + 1);
      this.handleLine(line);
      lineEnd = this.buffer.indexOf("\n");
    }
  }

  private handleLine(line: string): void {
    if (line.trim().length === 0) return;

    let payload: unknown;
    try {
      payload = JSON.parse(line);
    } catch {
      return;
    }

    if (isAgentIpcEvent(payload)) {
      for (const listener of this.listeners) listener(payload);
      return;
    }

    if (typeof payload !== "object" || payload === null) return;
    const response = payload as { id?: unknown; result?: unknown; error?: unknown };
    if (typeof response.id !== "number") return;

    const request = this.pending.get(response.id);
    if (!request) return;

    this.pending.delete(response.id);
    clearTimeout(request.timeout);
    if (response.error !== undefined && response.error !== null) {
      request.reject(toError(response.error, "El servidor del agente devolvió un error"));
      return;
    }
    request.resolve(response.result);
  }

  private stop(generation: number, error: Error): void {
    if (this.generation !== generation) return;

    this.generation += 1;
    this.process = undefined;
    this.processGeneration = 0;
    this.startPromise = undefined;
    this.buffer = "";
    for (const request of this.pending.values()) {
      clearTimeout(request.timeout);
      request.reject(error);
    }
    this.pending.clear();
  }
}
