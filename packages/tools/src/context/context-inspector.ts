import { z } from "zod";
import { defineTool } from "../registry.js";

const MessageInput = z.object({ id: z.string(), role: z.string(), content: z.string() });
const ContextInspectorInput = z.object({ messages: z.array(MessageInput) });
const ContextInspectorOutput = z.object({
  totalMessages: z.number(),
  byRole: z.record(z.number()),
  estimatedTokens: z.number()
});

// ponytail: heurística de 4 chars/token (la misma que usan la mayoría de SDKs
// para estimaciones rápidas sin tokenizador); Fase 7 introducirá un contador
// real por modelo cuando la compactación automática lo necesite.
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export const ContextInspector = defineTool({
  name: "Context_Inspector",
  description: "Resume la conversación actual: nº de mensajes por rol y tokens estimados.",
  inputSchema: ContextInspectorInput,
  outputSchema: ContextInspectorOutput,
  handler: async ({ messages }) => {
    const byRole: Record<string, number> = {};
    let estimatedTokens = 0;
    for (const message of messages) {
      byRole[message.role] = (byRole[message.role] ?? 0) + 1;
      estimatedTokens += estimateTokens(message.content);
    }
    return { totalMessages: messages.length, byRole, estimatedTokens };
  }
});
