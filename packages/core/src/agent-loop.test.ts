import { describe, expect, it } from "vitest";
import type { AgentInterface, AgentMessage, AgentRunResult, LoopGovernance } from "@agentev4/shared";
import { runAgenticLoop } from "./agent-loop.js";

function baseMessages(): AgentMessage[] {
  return [{ id: "u1", role: "user", content: "hola", createdAt: new Date() }];
}

function baseGovernance(overrides: Partial<LoopGovernance> = {}): LoopGovernance {
  return { maxTurns: 10, maxBudgetUsd: 10, effortLevel: "medium", ...overrides };
}

function scriptedAgent(runs: AgentRunResult[]): AgentInterface {
  let call = 0;
  return {
    async run(): Promise<AgentRunResult> {
      const result = runs[Math.min(call, runs.length - 1)];
      call += 1;
      if (!result) throw new Error("scriptedAgent misconfigured");
      return result;
    },
    async submitToolResult(): Promise<void> {}
  };
}

function assistantMessage(content: string): AgentMessage {
  return { id: crypto.randomUUID(), role: "assistant", content, createdAt: new Date() };
}

describe("runAgenticLoop", () => {
  it("stops on end_turn", async () => {
    const agent = scriptedAgent([
      { message: assistantMessage("listo"), toolCalls: [], stopReason: "end_turn", costUsd: 0 }
    ]);
    const result = await runAgenticLoop({
      agent,
      mode: "assistant",
      messages: baseMessages(),
      governance: baseGovernance()
    });
    expect(result.haltReason).toBe("end_turn");
    expect(result.turnsUsed).toBe(1);
  });

  it("stops on max_tokens", async () => {
    const agent = scriptedAgent([
      { message: assistantMessage("cortado..."), toolCalls: [], stopReason: "max_tokens", costUsd: 0 }
    ]);
    const result = await runAgenticLoop({
      agent,
      mode: "assistant",
      messages: baseMessages(),
      governance: baseGovernance()
    });
    expect(result.haltReason).toBe("max_tokens");
  });

  it("chains tool_use turns in agent mode until end_turn", async () => {
    const agent = scriptedAgent([
      {
        message: assistantMessage("necesito una tool"),
        toolCalls: [{ id: "call-1", name: "noop", input: {} }],
        stopReason: "tool_use",
        costUsd: 0
      },
      { message: assistantMessage("hecho"), toolCalls: [], stopReason: "end_turn", costUsd: 0 }
    ]);
    const result = await runAgenticLoop({
      agent,
      mode: "agent",
      messages: baseMessages(),
      governance: baseGovernance(),
      executeTool: async (call) => ({ toolCallId: call.id, output: "ok", isError: false })
    });
    expect(result.haltReason).toBe("end_turn");
    expect(result.turnsUsed).toBe(2);
    expect(result.messages.some((m) => m.role === "tool" && m.content === "ok")).toBe(true);
  });

  it("exposes a pending tool_use without executing it outside agent mode", async () => {
    const agent = scriptedAgent([
      {
        message: assistantMessage("necesito una tool"),
        toolCalls: [{ id: "call-1", name: "noop", input: {} }],
        stopReason: "tool_use",
        costUsd: 0
      }
    ]);
    const result = await runAgenticLoop({
      agent,
      mode: "plan",
      messages: baseMessages(),
      governance: baseGovernance()
    });
    expect(result.haltReason).toBe("tool_use");
    expect(result.turnsUsed).toBe(1);
  });

  it("cuts off at max_turns", async () => {
    const agent = scriptedAgent([
      {
        message: assistantMessage("otra vez"),
        toolCalls: [{ id: "call-1", name: "noop", input: {} }],
        stopReason: "tool_use",
        costUsd: 0
      }
    ]);
    const result = await runAgenticLoop({
      agent,
      mode: "agent",
      messages: baseMessages(),
      governance: baseGovernance({ maxTurns: 2 }),
      executeTool: async (call) => ({ toolCallId: call.id, output: "ok", isError: false })
    });
    expect(result.haltReason).toBe("max_turns");
    expect(result.turnsUsed).toBe(2);
  });

  it("cuts off at max_budget_usd", async () => {
    const agent = scriptedAgent([
      {
        message: assistantMessage("caro"),
        toolCalls: [{ id: "call-1", name: "noop", input: {} }],
        stopReason: "tool_use",
        costUsd: 0.6
      }
    ]);
    const result = await runAgenticLoop({
      agent,
      mode: "agent",
      messages: baseMessages(),
      governance: baseGovernance({ maxBudgetUsd: 1 }),
      executeTool: async (call) => ({ toolCallId: call.id, output: "ok", isError: false })
    });
    expect(result.haltReason).toBe("max_budget_usd");
    expect(result.turnsUsed).toBe(2);
    expect(result.costUsd).toBeCloseTo(1.2);
  });

  it("forwards onDelta to the agent so streaming progress reaches the caller", async () => {
    const deltas: Array<[string, string]> = [];
    const agent: AgentInterface = {
      async run(input) {
        input.onDelta?.("hola ", "msg-1");
        input.onDelta?.("mundo", "msg-1");
        return { message: assistantMessage("hola mundo"), toolCalls: [], stopReason: "end_turn", costUsd: 0 };
      },
      async submitToolResult(): Promise<void> {}
    };

    await runAgenticLoop({
      agent,
      mode: "assistant",
      messages: baseMessages(),
      governance: baseGovernance(),
      onDelta: (delta, messageId) => deltas.push([delta, messageId])
    });

    expect(deltas).toEqual([
      ["hola ", "msg-1"],
      ["mundo", "msg-1"]
    ]);
  });
});
