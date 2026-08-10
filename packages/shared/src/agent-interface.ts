import type { AgentMessage, LoopGovernance, StopReason } from "./schemas/messages.js";
import type { ToolCall, ToolResult } from "./schemas/tools.js";
import type { LlmProviderConfig } from "./schemas/provider.js";

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
  create(config: LlmProviderConfig): AgentInterface;
}
