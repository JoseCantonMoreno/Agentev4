import { AgentIpcEventSchema, type AgentIpcEvent } from "@agentev4/shared";

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
export type RpcLifecycleEvent =
  | { type: "process:started" }
  | { type: "process:stopped"; message: string }
  | { type: "protocol:error"; message: string };
export type LifecycleListener = (event: RpcLifecycleEvent) => void;

export interface RpcCallOptions {
  /** `false` evita abandonar en cliente una operacion que sigue viva en servidor. */
  timeoutMs?: number | false;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timeout: ReturnType<typeof setTimeout> | undefined;
}

function toError(value: unknown, fallback: string): Error {
  if (value instanceof Error) return value;
  if (typeof value === "string" && value.length > 0) return new Error(value);
  return new Error(fallback);
}

export class RpcClient {
  private readonly pending = new Map<number, PendingRequest>();
  private readonly listeners = new Set<EventListener>();
  private readonly lifecycleListeners = new Set<LifecycleListener>();
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

  call<T>(method: string, params?: Record<string, unknown>, options?: RpcCallOptions): Promise<T> {
    return this.ensureProcess().then(
      (process) => this.writeRequest<T>(process, method, params, options),
      (error: unknown) =>
        Promise.reject(toError(error, "No se pudo iniciar el servidor del agente"))
    );
  }

  subscribe(listener: EventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  subscribeLifecycle(listener: LifecycleListener): () => void {
    this.lifecycleListeners.add(listener);
    return () => this.lifecycleListeners.delete(listener);
  }

  private ensureProcess(): Promise<RpcWritableProcess> {
    if (this.process) return Promise.resolve(this.process);
    if (this.startPromise) return this.startPromise;

    const generation = ++this.generation;
    const startup = this.factory.start({
      stdout: (chunk) => this.handleStdout(generation, chunk),
      stderr: () => undefined,
      close: () =>
        this.stop(
          generation,
          new Error("El servidor del agente se cerr\u00f3"),
          "El servidor del agente se cerr\u00f3"
        ),
      error: (message) =>
        this.stop(
          generation,
          toError(message, "El servidor del agente fall\u00f3"),
          "El servidor del agente fall\u00f3"
        )
    });
    const startPromise = startup.then(
      (process) => {
        if (this.generation !== generation) {
          throw new Error("El servidor del agente se cerr\u00f3");
        }
        this.process = process;
        this.processGeneration = generation;
        this.emitLifecycle({ type: "process:started" });
        return process;
      },
      (error: unknown) => {
        const failure = toError(error, "No se pudo iniciar el servidor del agente");
        this.stop(generation, failure, "No se pudo iniciar el servidor del agente");
        throw failure;
      }
    );

    this.startPromise = startPromise;
    void startPromise.catch(() => {
      if (this.startPromise === startPromise) this.startPromise = undefined;
    });
    return startPromise;
  }

  private writeRequest<T>(
    process: RpcWritableProcess,
    method: string,
    params: Record<string, unknown> | undefined,
    options: RpcCallOptions | undefined
  ): Promise<T> {
    if (this.process !== process) {
      return Promise.reject(new Error("El servidor del agente se cerr\u00f3"));
    }

    const generation = this.processGeneration;
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timeoutMs = options?.timeoutMs ?? this.timeoutMs;
      const timeout =
        timeoutMs === false
          ? undefined
          : setTimeout(() => {
              const request = this.pending.get(id);
              if (!request) return;
              this.pending.delete(id);
              request.reject(new Error("Tiempo de espera agotado"));
            }, timeoutMs);

      this.pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timeout
      });

      void process.write(`${JSON.stringify({ id, method, params })}\n`).catch((error: unknown) => {
        this.stop(
          generation,
          toError(error, "No se pudo escribir al servidor del agente"),
          "No se pudo escribir al servidor del agente"
        );
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

    if (
      typeof payload === "object" &&
      payload !== null &&
      typeof (payload as { type?: unknown }).type === "string" &&
      (payload as { type: string }).type.startsWith("agent:")
    ) {
      const event = AgentIpcEventSchema.safeParse(payload);
      if (!event.success) {
        this.emitLifecycle({
          type: "protocol:error",
          message: "El servidor del agente envi\u00f3 un evento inv\u00e1lido"
        });
        return;
      }
      for (const listener of this.listeners) listener(event.data);
      return;
    }

    if (typeof payload !== "object" || payload === null) return;
    const response = payload as { id?: unknown; result?: unknown; error?: unknown };
    if (typeof response.id !== "number") return;

    const request = this.pending.get(response.id);
    if (!request) return;

    this.pending.delete(response.id);
    if (request.timeout) clearTimeout(request.timeout);
    if (response.error !== undefined && response.error !== null) {
      request.reject(toError(response.error, "El servidor del agente devolvi\u00f3 un error"));
      return;
    }
    request.resolve(response.result);
  }

  private stop(generation: number, error: Error, lifecycleMessage: string): void {
    if (this.generation !== generation) return;

    this.generation += 1;
    this.process = undefined;
    this.processGeneration = 0;
    this.startPromise = undefined;
    this.buffer = "";
    this.emitLifecycle({ type: "process:stopped", message: lifecycleMessage });
    for (const request of this.pending.values()) {
      if (request.timeout) clearTimeout(request.timeout);
      request.reject(error);
    }
    this.pending.clear();
  }

  private emitLifecycle(event: RpcLifecycleEvent): void {
    for (const listener of this.lifecycleListeners) listener(event);
  }
}
