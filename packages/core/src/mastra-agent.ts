import { randomUUID } from "node:crypto";
import { Agent } from "@mastra/core/agent";
import type { ModelMessage } from "ai";
import type {
  AgentFactory,
  AgentInterface,
  AgentMessage,
  AgentRunInput,
  AgentRunResult,
  LlmProviderConfig,
  StopReason
} from "@agentev4/shared";
import { resolveLanguageModel } from "./providers.js";

function toModelMessages(messages: AgentMessage[]): ModelMessage[] {
  return messages.map((message): ModelMessage => {
    if (message.role === "tool") {
      return {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: message.toolCallId ?? message.id,
            toolName: "unknown",
            output: { type: "text", value: message.content }
          }
        ]
      };
    }
    return { role: message.role, content: message.content };
  });
}

function toStopReason(finishReason: string | undefined): StopReason {
  if (finishReason === "tool-calls") return "tool_use";
  if (finishReason === "length") return "max_tokens";
  return "end_turn";
}

/**
 * Adaptador `AgentInterface` (Fase 1) sobre Mastra + Vercel AI SDK.
 * `maxSteps: 1` desactiva el bucle interno de tool-calling de Mastra:
 * cada `run()` es un único paso LLM, y el bucle multi-turno (gobernanza,
 * ejecución de tools) lo controla el orquestador de `agent-loop.ts`.
 */
export class MastraAgentAdapter implements AgentInterface {
  private readonly agent: Agent;

  constructor(config: LlmProviderConfig) {
    this.agent = new Agent({
      id: `agentev4-${config.provider}`,
      name: `Agentev4 (${config.provider})`,
      instructions: "You are Agentev4, an autonomous coding agent.",
      model: resolveLanguageModel(config)
    });
  }

  async run(input: AgentRunInput): Promise<AgentRunResult> {
    const result = await this.agent.generate(toModelMessages(input.messages), {
      maxSteps: 1
    });

    return {
      message: {
        id: randomUUID(),
        role: "assistant",
        content: result.text,
        createdAt: new Date()
      },
      toolCalls: result.toolCalls.map((call) => ({
        id: call.payload.toolCallId,
        name: call.payload.toolName,
        input: (call.payload.args ?? {}) as Record<string, unknown>
      })),
      stopReason: toStopReason(result.finishReason),
      // ponytail: sin tabla de precios por modelo todavía; el coste real
      // llega en Fase 10 (multiproveedor/resiliencia). El corte por
      // max_budget_usd ya es testeable con un AgentInterface simulado.
      costUsd: 0
    };
  }

  // ponytail: sin memoria persistente en Fase 2 (el orquestador ya reconstruye
  // el historial en cada run()); pasa a tener efecto real cuando Fase 6
  // conecte un Memory/thread de Mastra.
  async submitToolResult(): Promise<void> {}
}

export function createMastraAgentFactory(): AgentFactory {
  return {
    create(config: LlmProviderConfig): AgentInterface {
      return new MastraAgentAdapter(config);
    }
  };
}
