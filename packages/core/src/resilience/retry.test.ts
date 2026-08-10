import type { AgentInterface, AgentRunResult } from "@agentev4/shared";
import { describe, expect, it, vi } from "vitest";
import { createResilientAgent, isRetryableError, withRetry } from "./retry.js";

function rateLimitError(): Error {
  return Object.assign(new Error("rate limited"), { statusCode: 429 });
}

function unavailableError(): Error {
  return Object.assign(new Error("service unavailable"), { statusCode: 503 });
}

function badRequestError(): Error {
  return Object.assign(new Error("bad request"), { statusCode: 400 });
}

function fakeResult(text: string): AgentRunResult {
  return {
    message: { id: text, role: "assistant", content: text, createdAt: new Date() },
    toolCalls: [],
    stopReason: "end_turn",
    costUsd: 0
  };
}

function fakeAgent(run: AgentInterface["run"]): AgentInterface {
  return { run, submitToolResult: vi.fn() };
}

const input = { messages: [], governance: { maxTurns: 1, maxBudgetUsd: 1, effortLevel: "low" as const } };

describe("isRetryableError", () => {
  it("reconoce 429 y 503 como transitorios", () => {
    expect(isRetryableError(rateLimitError())).toBe(true);
    expect(isRetryableError(unavailableError())).toBe(true);
  });

  it("no reintenta errores no transitorios (ej. 400)", () => {
    expect(isRetryableError(badRequestError())).toBe(false);
  });
});

describe("withRetry", () => {
  it("reintenta con backoff creciente ante 429 repetidos y luego devuelve el resultado", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    let calls = 0;
    const fn = vi.fn(async () => {
      calls += 1;
      if (calls <= 2) throw rateLimitError();
      return "ok";
    });

    const result = await withRetry(fn, { maxRetries: 3, baseDelayMs: 100, sleep });

    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    const [firstDelay] = sleep.mock.calls[0]!;
    const [secondDelay] = sleep.mock.calls[1]!;
    expect(secondDelay).toBeGreaterThan(firstDelay);
  });

  it("no reintenta un error no transitorio", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const fn = vi.fn(async () => {
      throw badRequestError();
    });

    await expect(withRetry(fn, { sleep })).rejects.toThrow("bad request");
    expect(fn).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });
});

describe("createResilientAgent (DoD Fase 10)", () => {
  it("tras agotar reintentos con 429 repetidos en el primario, hace failover al secundario", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const primaryRun = vi.fn(async () => {
      throw rateLimitError();
    });
    const secondaryRun = vi.fn(async () => fakeResult("respuesta-secundaria"));

    const agent = createResilientAgent(fakeAgent(primaryRun), fakeAgent(secondaryRun), {
      maxRetries: 2,
      baseDelayMs: 50,
      sleep
    });

    const result = await agent.run(input);

    expect(result.message.content).toBe("respuesta-secundaria");
    expect(primaryRun).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(secondaryRun).toHaveBeenCalledTimes(1);
  });

  it("sin secundario configurado, propaga el error tras agotar reintentos", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const primaryRun = vi.fn(async () => {
      throw rateLimitError();
    });

    const agent = createResilientAgent(fakeAgent(primaryRun), undefined, { maxRetries: 1, sleep });

    await expect(agent.run(input)).rejects.toThrow("rate limited");
  });

  it("un error no transitorio no dispara failover", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const primaryRun = vi.fn(async () => {
      throw badRequestError();
    });
    const secondaryRun = vi.fn(async () => fakeResult("no-deberia-llamarse"));

    const agent = createResilientAgent(fakeAgent(primaryRun), fakeAgent(secondaryRun), { sleep });

    await expect(agent.run(input)).rejects.toThrow("bad request");
    expect(secondaryRun).not.toHaveBeenCalled();
  });
});
