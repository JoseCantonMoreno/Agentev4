/**
 * Script de prueba manual (sin UI) del Entregable de Fase 2: responde a un
 * prompt simple sin herramientas usando el AgentInterface real.
 *
 * Uso: ANTHROPIC_API_KEY=sk-... pnpm --filter @agentev4/core exec tsx src/scripts/run-example.ts
 */
import { createMastraAgentFactory, runAgenticLoop } from "../index.js";
import type { AgentMessage, LoopGovernance } from "@agentev4/shared";

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("Define ANTHROPIC_API_KEY para ejecutar este script.");
  }

  const factory = createMastraAgentFactory();
  const agent = factory.create({ provider: "anthropic", model: "claude-3-5-haiku-latest", apiKey });

  const messages: AgentMessage[] = [
    { id: "1", role: "user", content: "Say hello in one short sentence.", createdAt: new Date() }
  ];
  const governance: LoopGovernance = { maxTurns: 3, maxBudgetUsd: 1, effortLevel: "low" };

  const result = await runAgenticLoop({ agent, mode: "assistant", messages, governance });
  console.log(`stopReason=${result.haltReason}`);
  console.log(result.messages.at(-1)?.content);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
