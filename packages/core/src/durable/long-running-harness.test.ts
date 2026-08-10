import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentInterface, AgentMessage, LoopGovernance, ToolCall } from "@agentev4/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { latestCheckpoint, replayLog } from "./session-log.js";
import { runDurableTask } from "./long-running-harness.js";

const GOVERNANCE: LoopGovernance = { maxTurns: 100, maxBudgetUsd: 100, effortLevel: "low" };

/** Agente determinista: el turno se deriva del historial recibido (`messages.length`), nunca de estado interno propio — así da igual qué instancia lo ejecute. */
function createScriptedAgent(totalTurns: number): AgentInterface {
  return {
    async run({ messages }) {
      const turnNumber = messages.filter((m) => m.role === "assistant").length + 1;
      const isLast = turnNumber === totalTurns;
      return {
        message: { id: `a${turnNumber}`, role: "assistant", content: `turn-${turnNumber}`, createdAt: new Date() },
        toolCalls: isLast ? [] : [{ id: `t${turnNumber}`, name: "noop", input: {} }],
        stopReason: isLast ? "end_turn" : "tool_use",
        costUsd: 0
      };
    },
    async submitToolResult() {
      // sin estado que actualizar en este stub
    }
  };
}

function okExecutor() {
  return async (call: ToolCall) => ({ toolCallId: call.id, output: "ok", isError: false });
}

describe("runDurableTask", () => {
  let workspacePath: string;
  let logPath: string;
  const initialMessages: AgentMessage[] = [{ id: "u1", role: "user", content: "empieza la tarea larga", createdAt: new Date() }];

  beforeEach(async () => {
    workspacePath = await mkdtemp(join(tmpdir(), "agentev4-durable-harness-"));
    logPath = join(workspacePath, ".agente", "session.jsonl");
  });

  afterEach(async () => {
    await rm(workspacePath, { recursive: true, force: true });
  });

  it("ejecuta una tarea de 10 turnos sin interrupciones hasta end_turn", async () => {
    const result = await runDurableTask({
      logPath,
      workspacePath,
      agent: createScriptedAgent(10),
      mode: "agent",
      governance: GOVERNANCE,
      executeTool: okExecutor(),
      checkpointEveryNTurns: 3,
      initialMessages
    });

    expect(result.haltReason).toBe("end_turn");
    expect(result.turnsUsed).toBe(10);
    // 1 mensaje inicial + 10 asistente + 9 resultados de tool (el turno 10 no llama tool)
    expect(result.messages).toHaveLength(20);
  });

  it("DoD: matar el proceso a mitad de tarea y reanudar exactamente desde el último checkpoint vía replay del JSONL, sin pérdida de estado", async () => {
    // Ejecución de control, sin crash, para comparar el resultado final.
    const controlLogPath = join(workspacePath, ".agente", "control.jsonl");
    const controlResult = await runDurableTask({
      logPath: controlLogPath,
      workspacePath,
      agent: createScriptedAgent(10),
      mode: "agent",
      governance: GOVERNANCE,
      executeTool: okExecutor(),
      checkpointEveryNTurns: 3,
      initialMessages
    });

    // Ejecución real: el executeTool "crashea" (lanza) en la 7ª llamada,
    // simulando que el proceso muere a mitad de la tarea. Los checkpoints en
    // turnsUsed=3 y turnsUsed=6 ya deberían estar en disco para entonces.
    let callCount = 0;
    const crashingExecutor = async (call: ToolCall) => {
      callCount += 1;
      if (callCount === 7) throw new Error("simulated process crash");
      return { toolCallId: call.id, output: "ok", isError: false };
    };

    await expect(
      runDurableTask({
        logPath,
        workspacePath,
        agent: createScriptedAgent(10),
        mode: "agent",
        governance: GOVERNANCE,
        executeTool: crashingExecutor,
        checkpointEveryNTurns: 3,
        initialMessages
      })
    ).rejects.toThrow("simulated process crash");

    const entriesAfterCrash = await replayLog(logPath);
    const checkpointsAfterCrash = entriesAfterCrash.filter((e) => e.type === "checkpoint");
    expect(checkpointsAfterCrash).toHaveLength(2); // turnsUsed 3 y 6, nunca 9 (crash antes de llegar)

    // Reanudación: nueva llamada, agente y executor "frescos" (como tras
    // reiniciar el proceso), sin volver a pasar initialMessages -- el
    // harness debe reconstruir todo desde el último checkpoint del JSONL.
    const resumedResult = await runDurableTask({
      logPath,
      workspacePath,
      agent: createScriptedAgent(10),
      mode: "agent",
      governance: GOVERNANCE,
      executeTool: okExecutor(),
      checkpointEveryNTurns: 3
    });

    expect(resumedResult.haltReason).toBe("end_turn");
    expect(resumedResult.turnsUsed).toBe(10);
    // createdAt difiere entre ejecuciones (relojes de pared distintos); lo que importa
    // para "cero pérdida de estado" es que id/rol/contenido/toolCallId sean idénticos.
    const strip = (msgs: AgentMessage[]) => msgs.map(({ id, role, content, toolCallId }) => ({ id, role, content, toolCallId }));
    expect(strip(resumedResult.messages)).toEqual(strip(controlResult.messages));

    // El propio JSONL, re-reproducido desde cero, confirma el mismo estado final restaurable.
    const finalEntries = await replayLog(logPath);
    expect(latestCheckpoint(finalEntries)?.checkpoint.turnsUsed).toBe(9);
  });

  it("respeta el done-condition externo (.agente/progress.txt) sin depender del propio agente", async () => {
    const { mkdir, writeFile } = await import("node:fs/promises");
    await mkdir(join(workspacePath, ".agente"), { recursive: true });
    await writeFile(join(workspacePath, ".agente", "progress.txt"), "DONE\n", "utf8");

    const result = await runDurableTask({
      logPath,
      workspacePath,
      agent: createScriptedAgent(10),
      mode: "agent",
      governance: GOVERNANCE,
      executeTool: okExecutor(),
      initialMessages
    });

    expect(result.haltReason).toBe("done_condition");
    expect(result.turnsUsed).toBe(0);
  });

  it("HITL pausing: consumo cero de turnos mientras espera respuesta humana, y logea la pausa", async () => {
    const result = await runDurableTask({
      logPath,
      workspacePath,
      agent: createScriptedAgent(10),
      mode: "agent",
      governance: GOVERNANCE,
      executeTool: okExecutor(),
      initialMessages,
      needsHumanInput: () => true
    });

    expect(result.haltReason).toBe("hitl_pause");
    expect(result.turnsUsed).toBe(0);

    const entries = await replayLog(logPath);
    expect(entries.some((e) => e.type === "hitl_pause")).toBe(true);
  });

  it("resumeWith inyecta la respuesta humana antes de continuar tras un HITL pause", async () => {
    await runDurableTask({
      logPath,
      workspacePath,
      agent: createScriptedAgent(10),
      mode: "agent",
      governance: GOVERNANCE,
      executeTool: okExecutor(),
      initialMessages,
      needsHumanInput: () => true
    });

    const humanReply: AgentMessage = { id: "human1", role: "user", content: "adelante", createdAt: new Date() };
    const result = await runDurableTask({
      logPath,
      workspacePath,
      agent: createScriptedAgent(10),
      mode: "agent",
      governance: GOVERNANCE,
      executeTool: okExecutor(),
      checkpointEveryNTurns: 3,
      resumeWith: [humanReply]
    });

    expect(result.haltReason).toBe("end_turn");
    expect(result.messages.some((m) => m.id === "human1")).toBe(true);
  });
});
