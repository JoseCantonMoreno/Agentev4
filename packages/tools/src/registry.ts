import type { ToolCall, ToolDeclaration, ToolResult } from "@agentev4/shared";
import type { z } from "zod";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- ver ponytail más abajo
export interface ToolDefinition<TInput = any, TOutput = any> {
  name: string;
  description: string;
  // ponytail: tercer type param de ZodType (`Input`) fijado a `any` a
  // propósito — por defecto es igual a `Output`, y con esquemas `.default()`
  // (Output != Input real del schema) eso rompe la inferencia de TInput en
  // `defineTool`, ensanchándola a `T | undefined`. Aquí solo nos interesa el
  // lado Output (lo que produce `.parse`), no el lado Input (lo que acepta).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  inputSchema: z.ZodType<TInput, z.ZodTypeDef, any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  outputSchema: z.ZodType<TOutput, z.ZodTypeDef, any>;
  handler: (input: TInput) => Promise<TOutput>;
}

// ponytail: los defaults `any` (en vez de `unknown`) son deliberados: el
// registro agrupa tools con TInput/TOutput distintos y heterogéneos, y la
// validación real ocurre en runtime vía `inputSchema.safeParse` dentro de
// `executeRegisteredTool` — TS no puede (ni necesita) verificar en tiempo de
// compilación que el input de una tool concreta encaja con esta forma
// borrada; cada `defineTool<TInput, TOutput>` sigue totalmente tipado en su
// propio archivo.
export type ToolRegistry = Record<string, ToolDefinition>;

/** Identidad tipada: fija `TInput`/`TOutput` a partir del propio objeto, sin repetirlos. */
export function defineTool<TInput, TOutput>(
  definition: ToolDefinition<TInput, TOutput>
): ToolDefinition<TInput, TOutput> {
  return definition;
}

/**
 * Puente entre el registro de tools (Fase 5) y `runAgenticLoop` (Fase 2):
 * misma firma que `AgentLoopParams.executeTool`, validación Zod del input
 * antes de ejecutar, y captura de errores como `ToolResult.isError` en vez
 * de propagar excepciones al bucle del agente.
 */
export async function executeRegisteredTool(registry: ToolRegistry, call: ToolCall): Promise<ToolResult> {
  const tool = registry[call.name];
  if (!tool) {
    return { toolCallId: call.id, output: `Tool desconocida: "${call.name}"`, isError: true };
  }

  const parsed = tool.inputSchema.safeParse(call.input);
  if (!parsed.success) {
    return {
      toolCallId: call.id,
      output: `Input inválido para "${call.name}": ${parsed.error.message}`,
      isError: true
    };
  }

  try {
    const output = await tool.handler(parsed.data);
    return { toolCallId: call.id, output, isError: false };
  } catch (error) {
    return { toolCallId: call.id, output: error instanceof Error ? error.message : String(error), isError: true };
  }
}

/**
 * Proyecta un `ToolRegistry` (nativo, MCP, o cualquier mezcla) al contrato
 * agnóstico `ToolDeclaration[]` de la Fase 1, para pasarlo a `AgentFactory.create`.
 * Deliberadamente omite `handler`/`outputSchema`: el LLM solo necesita saber
 * nombre + descripción + forma del input, nunca cómo se ejecuta la tool.
 */
export function toToolDeclarations(registry: ToolRegistry): ToolDeclaration[] {
  return Object.values(registry).map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema
  }));
}
