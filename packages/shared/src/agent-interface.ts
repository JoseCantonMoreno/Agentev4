import type { ZodTypeAny } from "zod";
import type { AgentMessage, LoopGovernance, StopReason } from "./schemas/messages.js";
import type { ToolCall, ToolResult } from "./schemas/tools.js";
import type { LlmProviderConfig } from "./schemas/provider.js";

/**
 * Declaración de una tool ante el LLM (nombre + descripción + schema de
 * entrada), agnóstica del registro de tools concreto (`@agentev4/tools` no es
 * dependencia de `shared`). El adaptador de proveedor decide cómo traducirla
 * a su SDK; `shared` solo define el contrato mínimo para que el modelo sepa
 * que la tool existe y qué forma tiene su input.
 */
export interface ToolDeclaration {
  name: string;
  description: string;
  inputSchema: ZodTypeAny;
}

export interface AgentRunInput {
  messages: AgentMessage[];
  governance: LoopGovernance;
}

export interface AgentRunResult {
  message: AgentMessage;
  toolCalls: ToolCall[];
  stopReason: StopReason;
  /** Coste estimado de este turno en USD; 0 si el adaptador no lo calcula todavía. */
  costUsd: number;
}

/**
 * Capa de abstracción exigida por la REGLA DE ORO de prompt.md: cualquier
 * framework (Mastra, Vercel AI SDK, LangGraph, SDKs nativos...) implementa
 * este contrato como detalle de implementación, nunca al revés.
 */
export interface AgentInterface {
  run(input: AgentRunInput): Promise<AgentRunResult>;
  submitToolResult(result: ToolResult): Promise<void>;
}

export interface AgentFactory {
  create(config: LlmProviderConfig, tools?: ToolDeclaration[]): AgentInterface;
}
