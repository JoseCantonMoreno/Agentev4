export interface RpcRequest {
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

export interface RpcSuccess {
  id: number;
  result: unknown;
}

export interface RpcFailure {
  id: number;
  error: string;
}

export function isRpcRequest(value: unknown): value is RpcRequest {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.id === "number" && typeof candidate.method === "string";
}

export function encodeLine(value: unknown): string {
  return `${JSON.stringify(value)}\n`;
}

/**
 * Framing por líneas sobre un stream sin garantía de que cada chunk
 * contenga un mensaje completo (stdio de un proceso hijo lo trocea a su
 * antojo). `rest` es el remanente incompleto a re-alimentar en la próxima
 * llamada.
 */
export function parseLines(buffer: string): { messages: unknown[]; rest: string } {
  const lines = buffer.split("\n");
  const rest = lines.pop() ?? "";
  const messages = lines.filter((line) => line.trim().length > 0).map((line) => JSON.parse(line) as unknown);
  return { messages, rest };
}
