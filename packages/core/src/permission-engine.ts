import type { PermissionMode, ToolCall } from "@agentev4/shared";

export type PermissionDecision =
  | { behavior: "allow"; updatedInput?: Record<string, unknown> }
  | { behavior: "deny"; message: string };

/** Callback HITL inyectable: última instancia cuando nada más resuelve la decisión. */
export type CanUseTool = (call: ToolCall) => Promise<PermissionDecision>;

/** Hook Pre-ToolUse: puede resolver la decisión o devolver `undefined` para dejar pasar. */
export type PreToolUseHook = (
  call: ToolCall
) => Promise<PermissionDecision | undefined> | PermissionDecision | undefined;

export interface PermissionRuleSet {
  /** `"ToolName"` o `"ToolName(patron con * glob)"`, ej. `Bash(rm *)`, `Edit(/secrets/**)`. */
  deny: string[];
  ask: string[];
  allow: string[];
}

export interface PermissionEngineConfig {
  mode: PermissionMode;
  canUseTool: CanUseTool;
  hooks?: PreToolUseHook[];
  rules?: Partial<PermissionRuleSet>;
  /** Clasificadores de tool por nombre; Fase 5 registrará las tools reales y podrá sobreescribirlos. */
  isEditTool?: (toolName: string) => boolean;
  isReadOnlyTool?: (toolName: string) => boolean;
}

const DEFAULT_EDIT_PATTERN = /Write|Edit|Delete|Move|Commit/i;
const DEFAULT_READ_ONLY_PATTERN = /Read|Search|Inspector|Status|Diff|Log/i;

function defaultIsEditTool(name: string): boolean {
  return DEFAULT_EDIT_PATTERN.test(name);
}

function defaultIsReadOnlyTool(name: string): boolean {
  return !defaultIsEditTool(name) && DEFAULT_READ_ONLY_PATTERN.test(name);
}

function allow(updatedInput?: Record<string, unknown>): PermissionDecision {
  return updatedInput === undefined ? { behavior: "allow" } : { behavior: "allow", updatedInput };
}

function deny(message: string): PermissionDecision {
  return { behavior: "deny", message };
}

function parseRule(rule: string): { toolName: string; pattern: string | undefined } {
  const match = /^([^()]+)(?:\((.*)\))?$/.exec(rule);
  if (!match) throw new Error(`Regla de permiso inválida: "${rule}"`);
  return { toolName: (match[1] ?? "").trim(), pattern: match[2] };
}

function resolveSubject(input: Record<string, unknown>): string {
  for (const key of ["command", "path", "file", "filePath"]) {
    const value = input[key];
    if (typeof value === "string") return value;
  }
  return JSON.stringify(input);
}

// ponytail: sin distinción entre `*` y `**` (ambos se traducen a `.*`); no hace
// falta separar límites de directorio hasta que una tool real lo necesite.
function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`);
}

function matchesRule(rule: string, call: ToolCall): boolean {
  const { toolName, pattern } = parseRule(rule);
  if (toolName !== call.name) return false;
  if (pattern === undefined) return true;
  return globToRegExp(pattern).test(resolveSubject(call.input));
}

function matchesAny(rules: string[], call: ToolCall): boolean {
  return rules.some((rule) => matchesRule(rule, call));
}

/**
 * Pipeline de evaluación de permisos (orden no negociable, Fase 3):
 *  1. Hooks Pre-ToolUse — máxima prioridad, cualquiera puede resolver y cortar.
 *  2. bypassPermissions — única excepción a la orden literal: por definición de
 *     modo, ignora deny/ask/allow al completo (un "bypass" que sigue pidiendo
 *     confirmación no sería tal). Los hooks del paso 1 sí se siguen respetando.
 *  3. Reglas Deny — bloqueo definitivo, nunca llega a HITL.
 *  4. Reglas Ask — fuerzan el callback HITL pase lo que pase después.
 *  5. Modo de permiso activo (plan / acceptEdits resuelven directamente).
 *  6. Reglas Allow — aprobación explícita, nunca llega a HITL.
 *  7. dontAsk/auto nunca invocan HITL: dontAsk deniega en fail-closed, auto aprueba en fail-open.
 *  8. Callback HITL — último recurso (modo default, o acceptEdits sin match).
 */
export class PermissionEngine {
  private mode: PermissionMode;
  private readonly canUseTool: CanUseTool;
  private readonly hooks: PreToolUseHook[];
  private readonly rules: PermissionRuleSet;
  private readonly isEditTool: (name: string) => boolean;
  private readonly isReadOnlyTool: (name: string) => boolean;

  constructor(config: PermissionEngineConfig) {
    this.mode = config.mode;
    this.canUseTool = config.canUseTool;
    this.hooks = config.hooks ?? [];
    this.rules = {
      deny: config.rules?.deny ?? [],
      ask: config.rules?.ask ?? [],
      allow: config.rules?.allow ?? []
    };
    this.isEditTool = config.isEditTool ?? defaultIsEditTool;
    this.isReadOnlyTool = config.isReadOnlyTool ?? defaultIsReadOnlyTool;
  }

  setMode(mode: PermissionMode): void {
    this.mode = mode;
  }

  async evaluate(call: ToolCall): Promise<PermissionDecision> {
    for (const hook of this.hooks) {
      const decision = await hook(call);
      if (decision) return decision;
    }

    if (this.mode === "bypassPermissions") {
      return allow();
    }

    if (matchesAny(this.rules.deny, call)) {
      return deny(`Bloqueado por regla deny: ${call.name}`);
    }

    if (matchesAny(this.rules.ask, call)) {
      return this.canUseTool(call);
    }

    if (this.mode === "plan") {
      return this.isReadOnlyTool(call.name)
        ? allow()
        : deny(`Modo plan: "${call.name}" no es de solo lectura`);
    }

    if (this.mode === "acceptEdits" && this.isEditTool(call.name)) {
      return allow();
    }

    if (matchesAny(this.rules.allow, call)) {
      return allow();
    }

    if (this.mode === "dontAsk") {
      return deny(`Modo dontAsk: "${call.name}" no está en la allow-list`);
    }

    if (this.mode === "auto") {
      return allow();
    }

    return this.canUseTool(call);
  }
}
