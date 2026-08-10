import { describe, expect, it } from "vitest";
import { type EphemeralExecutor, runEvaluator } from "./evaluator.js";

function fakeExecutor(exitCodes: Record<string, number>): EphemeralExecutor {
  return (async (cmd: string) => ({
    stdout: `out:${cmd}`,
    stderr: "",
    exitCode: exitCodes[cmd] ?? 0,
    timedOut: false,
    containerName: "fake"
  })) as EphemeralExecutor;
}

describe("runEvaluator", () => {
  it("corre todos los comandos y pasa si todos tienen exit 0", async () => {
    const executor = fakeExecutor({});
    const result = await runEvaluator("/workspace", [
      { label: "lint", cmd: "pnpm lint" },
      { label: "test", cmd: "pnpm test" }
    ], executor);

    expect(result.passed).toBe(true);
    expect(result.results).toHaveLength(2);
    expect(result.results.every((r) => r.passed)).toBe(true);
  });

  it("se detiene en el primer comando que falla, sin correr los siguientes", async () => {
    const executor = fakeExecutor({ "pnpm lint": 1 });
    const result = await runEvaluator("/workspace", [
      { label: "lint", cmd: "pnpm lint" },
      { label: "test", cmd: "pnpm test" },
      { label: "build", cmd: "pnpm build" }
    ], executor);

    expect(result.passed).toBe(false);
    expect(result.results).toHaveLength(1);
    expect(result.results[0]?.passed).toBe(false);
  });

  it("un timeout cuenta como fallo aunque exitCode sea 0", async () => {
    const executor = (async () => ({
      stdout: "",
      stderr: "",
      exitCode: 0,
      timedOut: true,
      containerName: "fake"
    })) as EphemeralExecutor;

    const result = await runEvaluator("/workspace", [{ label: "test", cmd: "pnpm test" }], executor);
    expect(result.passed).toBe(false);
  });
});
