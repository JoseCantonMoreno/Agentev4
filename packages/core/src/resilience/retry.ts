import type { AgentInterface, AgentRunInput, AgentRunResult, ToolResult } from "@agentev4/shared";

export interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function extractStatusCode(error: unknown, depth = 0): number | undefined {
  if (depth > 3 || typeof error !== "object" || error === null) return undefined;
  const statusCode = (error as { statusCode?: unknown }).statusCode;
  if (typeof statusCode === "number") return statusCode;
  return extractStatusCode((error as { cause?: unknown }).cause, depth + 1);
}

/** 429 (rate limit) y 503 (servicio no disponible): errores transitorios reintentables. */
export function isRetryableError(error: unknown): boolean {
  const status = extractStatusCode(error);
  return status === 429 || status === 503;
}

/** Backoff exponencial con jitter: evita que reintentos sincronizados golpeen el proveedor a la vez. */
export function computeBackoffMs(attempt: number, baseDelayMs: number): number {
  return baseDelayMs * 2 ** attempt + Math.random() * baseDelayMs;
}

export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const maxRetries = opts.maxRetries ?? 3;
  const baseDelayMs = opts.baseDelayMs ?? 500;
  const sleep = opts.sleep ?? defaultSleep;

  for (let attempt = 0; ; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      if (attempt >= maxRetries || !isRetryableError(error)) throw error;
      await sleep(computeBackoffMs(attempt, baseDelayMs));
    }
  }
}

/**
 * Envuelve un `AgentInterface` (Fase 1) con reintentos + backoff sobre el
 * proveedor primario y, si se agotan y el error sigue siendo transitorio
 * (429/503), failover a un proveedor secundario. Opera detrás del contrato
 * de la Fase 1: no sabe nada de Mastra/AI SDK.
 */
export function createResilientAgent(
  primary: AgentInterface,
  secondary: AgentInterface | undefined,
  opts: RetryOptions = {}
): AgentInterface {
  return {
    async run(input: AgentRunInput): Promise<AgentRunResult> {
      try {
        return await withRetry(() => primary.run(input), opts);
      } catch (error) {
        if (!secondary || !isRetryableError(error)) throw error;
        return await withRetry(() => secondary.run(input), opts);
      }
    },
    async submitToolResult(result: ToolResult): Promise<void> {
      await primary.submitToolResult(result);
    }
  };
}
