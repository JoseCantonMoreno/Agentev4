import { runEphemeral } from "@agentev4/tools";

export interface EvaluatorCommand {
  label: string;
  cmd: string;
}

export interface EvaluatorCommandResult {
  label: string;
  cmd: string;
  passed: boolean;
  stdout: string;
  stderr: string;
}

export interface EvaluatorResult {
  passed: boolean;
  results: EvaluatorCommandResult[];
}

export type EphemeralExecutor = typeof runEphemeral;

/**
 * Evaluador separado del agente (Fase 8): corre tests/linter/build en un
 * sandbox desechable antes de dar por cerrada una subtarea, para que el
 * propio agente nunca sea juez de su trabajo. Se detiene en el primer
 * comando que falla (no tiene sentido correr el build si el lint ya rompió).
 * `executor` es inyectable (por defecto `runEphemeral` de la Fase 4) para
 * poder testear la lógica de evaluación sin depender de un daemon Docker real.
 */
export async function runEvaluator(
  workspacePath: string,
  commands: EvaluatorCommand[],
  executor: EphemeralExecutor = runEphemeral
): Promise<EvaluatorResult> {
  const results: EvaluatorCommandResult[] = [];
  for (const { label, cmd } of commands) {
    const execResult = await executor(cmd, { workspacePath });
    const passed = !execResult.timedOut && execResult.exitCode === 0;
    results.push({ label, cmd, passed, stdout: execResult.stdout, stderr: execResult.stderr });
    if (!passed) break;
  }
  return { passed: results.length === commands.length && results.every((result) => result.passed), results };
}
