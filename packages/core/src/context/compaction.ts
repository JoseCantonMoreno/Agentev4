import { randomUUID } from "node:crypto";
import type { AgentMessage, CompactBoundary, ContextBreakdown } from "@agentev4/shared";
import { countContextTokens, type ContextComponentsInput } from "./token-counter.js";

const DEFAULT_THRESHOLD = 0.8;
const DEFAULT_KEEP_RECENT = 6;

const FILE_PATH_PATTERN =
  /\b[\w][\w./-]*\.(?:ts|tsx|js|jsx|mjs|cjs|py|md|json|ya?ml|css|html|sql|rs|go|java)\b/g;
const DECISION_PATTERN = /\b(?:decidimos|decidí|se decidió|acordamos|optamos por|elegimos)\b/i;

export interface MaybeCompactInput extends ContextComponentsInput {
  maxTokens: number;
  /** Fracción de maxTokens que dispara la compactación. Default 0.8 (80%). */
  threshold?: number;
  /** Mensajes recientes que se mantienen sin resumir. Default 6. */
  keepRecent?: number;
}

export interface CompactionResult {
  compacted: boolean;
  messages: AgentMessage[];
  breakdown: ContextBreakdown;
  boundary?: CompactBoundary;
}

function extractGoals(messages: AgentMessage[]): string[] {
  const goals = messages.filter((message) => message.role === "user").map((message) => message.content.trim());
  return Array.from(new Set(goals));
}

function extractFiles(messages: AgentMessage[]): string[] {
  const files = new Set<string>();
  for (const message of messages) {
    for (const match of message.content.matchAll(FILE_PATH_PATTERN)) {
      if (match[0]) files.add(match[0]);
    }
  }
  return Array.from(files);
}

function extractDecisions(messages: AgentMessage[]): string[] {
  const decisions: string[] = [];
  for (const message of messages) {
    for (const sentence of message.content.split(/(?<=[.!?])\s+/)) {
      if (DECISION_PATTERN.test(sentence)) decisions.push(sentence.trim());
    }
  }
  return decisions;
}

function buildSummaryText(boundary: CompactBoundary): string {
  const lines = [`[Contexto compactado: ${boundary.summarizedCount} mensajes resumidos]`];
  if (boundary.preservedGoals.length > 0) lines.push(`Objetivos activos: ${boundary.preservedGoals.join(" | ")}`);
  if (boundary.preservedFiles.length > 0) lines.push(`Archivos editados: ${boundary.preservedFiles.join(", ")}`);
  if (boundary.preservedDecisions.length > 0) {
    lines.push(`Decisiones clave: ${boundary.preservedDecisions.join(" | ")}`);
  }
  return lines.join("\n");
}

/**
 * ponytail: síntesis heurística por regex (objetivos = mensajes de usuario,
 * archivos = paths con extensión conocida, decisiones = frases con verbos de
 * decisión) en vez de un resumen generado por LLM. Determinista y testeable
 * sin depender de un proveedor; sube a resumen vía agente (reutilizando
 * AgentInterface de Fase 1) si la heurística pierde contexto real en uso.
 */
export function maybeCompact(input: MaybeCompactInput): CompactionResult {
  const { systemPrompt, rules, tools, messages, maxTokens } = input;
  const threshold = input.threshold ?? DEFAULT_THRESHOLD;
  const keepRecent = input.keepRecent ?? DEFAULT_KEEP_RECENT;

  const breakdown = countContextTokens({ systemPrompt, rules, tools, messages });
  const ratio = breakdown.total / maxTokens;
  const toCompact = messages.slice(0, Math.max(0, messages.length - keepRecent));

  if (ratio < threshold || toCompact.length === 0) {
    return { compacted: false, messages, breakdown };
  }

  const recent = messages.slice(messages.length - keepRecent);
  const boundary: CompactBoundary = {
    id: randomUUID(),
    summarizedCount: toCompact.length,
    preservedGoals: extractGoals(toCompact),
    preservedFiles: extractFiles(toCompact),
    preservedDecisions: extractDecisions(toCompact),
    createdAt: new Date()
  };

  const boundaryMessage: AgentMessage = {
    id: boundary.id,
    role: "system",
    content: buildSummaryText(boundary),
    createdAt: boundary.createdAt
  };

  const newMessages = [boundaryMessage, ...recent];
  return {
    compacted: true,
    messages: newMessages,
    breakdown: countContextTokens({ systemPrompt, rules, tools, messages: newMessages }),
    boundary
  };
}
