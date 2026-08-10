import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentInterface, AgentMessage, AgentRunResult, LoopGovernance, ToolCall } from "@agentev4/shared";
import { defineTool, executeRegisteredTool, type ToolRegistry } from "@agentev4/tools";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { type DatabaseHandle, openDatabase } from "./db/client.js";
import { SessionManager } from "./db/session-manager.js";
import { PermissionEngine, type CanUseTool, type PermissionDecision } from "./permission-engine.js";
import { runAgenticLoop } from "./agent-loop.js";

const GOVERNANCE: LoopGovernance = { maxTurns: 10, maxBudgetUsd: 10, effortLevel: "low" };

const registry: ToolRegistry = {
  Echo: defineTool({
    name: "Echo",
    description: "Devuelve el input tal cual, para verificar que la tool realmente se ejecutó.",
    inputSchema: z.object({ text: z.string() }),
    outputSchema: z.string(),
    handler: async (input) => `echo:${input.text}`
  })
};

/** Agente guionizado de 2 turnos: pide `Echo`, luego termina con lo que recibió como resultado de esa tool. */
function scriptedAgentCallingTool(toolName: string): AgentInterface {
  let call = 0;
  let lastToolOutput = "";
  return {
    async run(): Promise<AgentRunResult> {
      call += 1;
      if (call === 1) {
        return {
          message: { id: "a1", role: "assistant", content: "necesito la tool", createdAt: new Date() },
          toolCalls: [{ id: "call-1", name: toolName, input: { text: "hola" } }],
          stopReason: "tool_use",
          costUsd: 0.01
        };
      }
      return {
        message: { id: "a2", role: "assistant", content: `recibido: ${lastToolOutput}`, createdAt: new Date() },
        toolCalls: [],
        stopReason: "end_turn",
        costUsd: 0.01
      };
    },
    async submitToolResult(result) {
      lastToolOutput = typeof result.output === "string" ? result.output : JSON.stringify(result.output);
    }
  };
}

/**
 * Integración Fase 12 ("Agentic Loop completo"): reproduce la misma composición que
 * `sendPrompt` del sidecar (apps/desktop/server) -- PermissionEngine real +
 * registro de tools real + SessionManager con SQLite real -- pero con un
 * `AgentInterface` guionizado en vez de una llamada real a un proveedor LLM,
 * igual que ya hacen `agent-loop.test.ts` (Fase 2) y `long-running-harness.test.ts`
 * (Fase 8). El objetivo no es reprobar el motor de permisos ni el registro por
 * separado (ya cubiertos en Fase 3 y Fase 5), sino confirmar que el cableado
 * conjunto -- Context Assembly -> LLM Execution -> Tool Decision (con permisos
 * reales) -> History Accumulation (persistida en SQLite) -> Re-evaluation --
 * funciona de punta a punta.
 */
describe("Agentic Loop completo: PermissionEngine + registry + SessionManager reales", () => {
  let workspacePath: string;
  let handle: DatabaseHandle;
  let sessionManager: SessionManager;

  beforeEach(async () => {
    workspacePath = await mkdtemp(join(tmpdir(), "agentev4-loop-e2e-"));
    handle = openDatabase(":memory:");
    sessionManager = new SessionManager(handle.db);
  });

  afterEach(async () => {
    handle.close();
    await rm(workspacePath, { recursive: true, force: true });
  });

  function makeExecuteTool(permissionEngine: PermissionEngine, sessionId: string) {
    return async (call: ToolCall) => {
      const decision = await permissionEngine.evaluate(call);
      if (decision.behavior === "deny") {
        const result = { toolCallId: call.id, output: decision.message, isError: true };
        sessionManager.recordToolExecution(sessionId, call, result);
        return result;
      }
      const result = await executeRegisteredTool(registry, call);
      sessionManager.recordToolExecution(sessionId, call, result);
      return result;
    };
  }

  it("una tool bloqueada por deny nunca llega al handler ni a HITL, y el resultado se persiste en la sesión", async () => {
    const session = sessionManager.createSession({
      name: "s-deny",
      workspacePath,
      mode: "agent",
      permissionMode: "default"
    });
    const canUseTool: CanUseTool = async () => ({ behavior: "allow" }) satisfies PermissionDecision;
    let hitlCalled = false;
    const permissionEngine = new PermissionEngine({
      mode: "default",
      canUseTool: async (call) => {
        hitlCalled = true;
        return canUseTool(call);
      },
      rules: { deny: ["Echo"] }
    });

    const initialMessages: AgentMessage[] = [{ id: "u1", role: "user", content: "usa Echo", createdAt: new Date() }];
    const result = await runAgenticLoop({
      agent: scriptedAgentCallingTool("Echo"),
      mode: session.mode,
      messages: initialMessages,
      governance: GOVERNANCE,
      executeTool: makeExecuteTool(permissionEngine, session.id)
    });

    expect(hitlCalled).toBe(false);
    expect(result.haltReason).toBe("end_turn");
    const toolMessage = result.messages.find((m) => m.role === "tool");
    expect(toolMessage?.content).toContain("Bloqueado por regla deny");

    for (const message of result.messages) sessionManager.appendMessage(session.id, message);
    const persisted = sessionManager.listMessages(session.id);
    expect(persisted.some((m) => m.role === "tool" && m.content.includes("Bloqueado por regla deny"))).toBe(true);
  });

  it("una tool en modo ask bloquea el loop hasta que el HITL resuelve, y solo entonces se ejecuta de verdad", async () => {
    const session = sessionManager.createSession({
      name: "s-ask",
      workspacePath,
      mode: "agent",
      permissionMode: "default"
    });

    let resolveHitl!: (decision: PermissionDecision) => void;
    const hitlPromise = new Promise<PermissionDecision>((resolve) => {
      resolveHitl = resolve;
    });
    const permissionEngine = new PermissionEngine({
      mode: "default",
      canUseTool: () => hitlPromise,
      rules: { ask: ["Echo"] }
    });

    const initialMessages: AgentMessage[] = [{ id: "u1", role: "user", content: "usa Echo", createdAt: new Date() }];
    const pending = runAgenticLoop({
      agent: scriptedAgentCallingTool("Echo"),
      mode: session.mode,
      messages: initialMessages,
      governance: GOVERNANCE,
      executeTool: makeExecuteTool(permissionEngine, session.id)
    });

    // El loop debe seguir sin resolver mientras el HITL no responde: "bloquea hasta respuesta" (Fase 11 DoD).
    let settled = false;
    void pending.then(() => {
      settled = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(settled).toBe(false);

    resolveHitl({ behavior: "allow" });
    const result = await pending;

    expect(result.haltReason).toBe("end_turn");
    const toolMessage = result.messages.find((m) => m.role === "tool");
    expect(toolMessage?.content).toBe("echo:hola");
    expect(result.messages.find((m) => m.role === "assistant" && m.id === "a2")?.content).toBe("recibido: echo:hola");
  });

  it("una tool permitida se ejecuta y el turno completo queda persistido en la sesión SQLite", async () => {
    const session = sessionManager.createSession({
      name: "s-allow",
      workspacePath,
      mode: "agent",
      permissionMode: "default"
    });
    const permissionEngine = new PermissionEngine({
      mode: "default",
      canUseTool: async () => ({ behavior: "allow" }),
      rules: { allow: ["Echo"] }
    });

    const initialMessages: AgentMessage[] = [{ id: "u1", role: "user", content: "usa Echo", createdAt: new Date() }];
    const result = await runAgenticLoop({
      agent: scriptedAgentCallingTool("Echo"),
      mode: session.mode,
      messages: initialMessages,
      governance: GOVERNANCE,
      executeTool: makeExecuteTool(permissionEngine, session.id)
    });

    expect(result.haltReason).toBe("end_turn");
    expect(result.turnsUsed).toBe(2);

    for (const message of result.messages) sessionManager.appendMessage(session.id, message);
    const persisted = sessionManager.listMessages(session.id);
    expect(persisted).toHaveLength(result.messages.length);
    expect(persisted.some((m) => m.role === "tool" && m.content === "echo:hola")).toBe(true);
  });
});
