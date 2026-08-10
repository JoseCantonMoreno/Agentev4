import type {
  AgentInterface,
  AgentMessage,
  AgentMode,
  LoopGovernance,
  ToolCall,
  ToolResult
} from "@agentev4/shared";
import { toolResultMessage } from "../agent-loop.js";
import { checkDoneCondition } from "./done-condition.js";
import { appendLogEntry, latestCheckpoint, replayLog } from "./session-log.js";

export type DurableHaltReason =
  | "tool_use"
  | "end_turn"
  | "max_tokens"
  | "max_turns"
  | "max_budget_usd"
  | "done_condition"
  | "hitl_pause";

export interface DurableHarnessParams {
  logPath: string;
  workspacePath: string;
  agent: AgentInterface;
  mode: AgentMode;
  governance: LoopGovernance;
  executeTool?: (call: ToolCall) => Promise<ToolResult>;
  /** Checkpoint cada N turnos completados, no cada paso (ver DoD Fase 8). */
  checkpointEveryNTurns?: number;
  /** Mensajes de arranque; se ignoran si `logPath` ya tiene un checkpoint previo. */
  initialMessages?: AgentMessage[];
  /** Mensajes a inyectar tras restaurar el estado (p.ej. la respuesta humana de un HITL pause). */
  resumeWith?: AgentMessage[];
  /** Si devuelve true, el harness pausa sin consumir turno ni presupuesto. */
  needsHumanInput?: (messages: AgentMessage[]) => boolean;
}

export interface DurableRunResult {
  messages: AgentMessage[];
  turnsUsed: number;
  haltReason: DurableHaltReason;
}

const DEFAULT_CHECKPOINT_EVERY = 5;

/**
 * Harness stateless (Fase 8): cada llamada reconstruye su estado
 * exclusivamente desde el JSONL en `logPath` (el último checkpoint), nunca
 * desde memoria de una invocación anterior -- así reanudar tras un "crash"
 * del proceso es indistinguible de una continuación normal.
 */
export async function runDurableTask(params: DurableHarnessParams): Promise<DurableRunResult> {
  const checkpointEvery = params.checkpointEveryNTurns ?? DEFAULT_CHECKPOINT_EVERY;
  const priorEntries = await replayLog(params.logPath);
  const checkpoint = latestCheckpoint(priorEntries);

  let messages = checkpoint ? checkpoint.checkpoint.messages : (params.initialMessages ?? []);
  let turnsUsed = checkpoint ? checkpoint.checkpoint.turnsUsed : 0;
  let costUsd = 0;

  for (const resumeMessage of params.resumeWith ?? []) {
    messages = [...messages, resumeMessage];
    await appendLogEntry(params.logPath, { type: "message", message: resumeMessage });
  }

  while (true) {
    const done = await checkDoneCondition(params.workspacePath);
    if (done.done) return { messages, turnsUsed, haltReason: "done_condition" };

    if (params.needsHumanInput?.(messages)) {
      await appendLogEntry(params.logPath, { type: "hitl_pause", reason: "esperando respuesta humana" });
      return { messages, turnsUsed, haltReason: "hitl_pause" };
    }

    if (turnsUsed >= params.governance.maxTurns) {
      return { messages, turnsUsed, haltReason: "max_turns" };
    }
    if (costUsd >= params.governance.maxBudgetUsd) {
      return { messages, turnsUsed, haltReason: "max_budget_usd" };
    }

    const result = await params.agent.run({ messages, governance: params.governance });
    turnsUsed += 1;
    costUsd += result.costUsd;
    messages = [...messages, result.message];
    await appendLogEntry(params.logPath, { type: "message", message: result.message });

    const canAutoExecuteTools = params.mode === "agent" && result.stopReason === "tool_use" && params.executeTool;
    if (canAutoExecuteTools) {
      for (const call of result.toolCalls) {
        await appendLogEntry(params.logPath, { type: "tool_call", call });
        const toolResult = await params.executeTool!(call);
        await appendLogEntry(params.logPath, { type: "tool_result", result: toolResult });
        await params.agent.submitToolResult(toolResult);
        const resultMessage = toolResultMessage(toolResult);
        messages = [...messages, resultMessage];
        await appendLogEntry(params.logPath, { type: "message", message: resultMessage });
      }
    }

    if (turnsUsed % checkpointEvery === 0) {
      await appendLogEntry(params.logPath, { type: "checkpoint", checkpoint: { turnsUsed, messages } });
    }

    if (!canAutoExecuteTools) {
      return { messages, turnsUsed, haltReason: result.stopReason };
    }
  }
}
