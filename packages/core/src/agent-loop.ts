import type {
  AgentInterface,
  AgentMessage,
  AgentMode,
  LoopGovernance,
  StopReason,
  ToolCall,
  ToolResult
} from "@agentev4/shared";

export type LoopHaltReason = StopReason | "max_turns" | "max_budget_usd";

export interface AgentLoopParams {
  agent: AgentInterface;
  mode: AgentMode;
  messages: AgentMessage[];
  governance: LoopGovernance;
  /** Ejecutor de tools inyectable; sin él (Fase 3/5 aún no listas) el bucle
   * se limita a exponer el tool_use pendiente al llamador. */
  executeTool?: (call: ToolCall) => Promise<ToolResult>;
  /** Progreso incremental del turno en curso; ver `AgentRunInput.onDelta`. */
  onDelta?: (delta: string, messageId: string) => void;
}

export interface AgentLoopResult {
  messages: AgentMessage[];
  haltReason: LoopHaltReason;
  turnsUsed: number;
  costUsd: number;
}

export function toolResultMessage(result: ToolResult): AgentMessage {
  return {
    id: result.toolCallId,
    role: "tool",
    content: typeof result.output === "string" ? result.output : JSON.stringify(result.output),
    toolCallId: result.toolCallId,
    createdAt: new Date()
  };
}

/**
 * Context Assembly -> LLM Execution -> Tool Decision -> History Accumulation
 * -> Re-evaluation (Fase 2), detrás de `AgentInterface`. Solo el modo
 * "agent" con `executeTool` encadena turnos automáticamente; "assistant" y
 * "plan" se detienen tras el primer turno (solo lectura / respuesta directa).
 */
export async function runAgenticLoop(params: AgentLoopParams): Promise<AgentLoopResult> {
  const { agent, mode, governance, executeTool, onDelta } = params;
  let messages = params.messages;
  let turnsUsed = 0;
  let costUsd = 0;

  while (true) {
    if (turnsUsed >= governance.maxTurns) {
      return { messages, haltReason: "max_turns", turnsUsed, costUsd };
    }
    if (costUsd >= governance.maxBudgetUsd) {
      return { messages, haltReason: "max_budget_usd", turnsUsed, costUsd };
    }

    const result = await agent.run({ messages, governance, ...(onDelta ? { onDelta } : {}) });
    turnsUsed += 1;
    costUsd += result.costUsd;
    messages = [...messages, result.message];

    const canAutoExecuteTools = mode === "agent" && result.stopReason === "tool_use" && executeTool;
    if (!canAutoExecuteTools) {
      return { messages, haltReason: result.stopReason, turnsUsed, costUsd };
    }

    for (const call of result.toolCalls) {
      const toolResult = await executeTool(call);
      await agent.submitToolResult(toolResult);
      messages = [...messages, toolResultMessage(toolResult)];
    }
  }
}
