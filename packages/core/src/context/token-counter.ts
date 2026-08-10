import type { AgentMessage, ContextBreakdown } from "@agentev4/shared";

const CHARS_PER_TOKEN = 4;

/**
 * ponytail: aproximación por caracteres (~4 caracteres/token, regla general
 * para modelos GPT/Claude en inglés/español). Sube a un tokenizer real
 * (tiktoken/gpt-tokenizer o el endpoint count_tokens del proveedor) si se
 * necesita precisión exacta antes de un corte duro de contexto.
 */
export function countTokens(text: string): number {
  if (text.length === 0) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export interface ContextComponentsInput {
  systemPrompt: string;
  rules: string;
  tools: string;
  messages: AgentMessage[];
}

export function countContextTokens(input: ContextComponentsInput): ContextBreakdown {
  const systemPrompt = countTokens(input.systemPrompt);
  const rules = countTokens(input.rules);
  const tools = countTokens(input.tools);
  const history = input.messages.reduce((sum, message) => sum + countTokens(message.content), 0);
  return { systemPrompt, rules, tools, history, total: systemPrompt + rules + tools + history };
}
