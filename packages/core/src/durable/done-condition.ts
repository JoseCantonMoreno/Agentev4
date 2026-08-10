import { readFile } from "node:fs/promises";
import { join } from "node:path";

export interface DoneConditionResult {
  done: boolean;
  source: "prd.json" | "progress.txt" | "plan.md" | "none";
}

async function tryRead(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

/**
 * Condición de "hecho" externa y verificable (Fase 8): nunca se confía en la
 * autoevaluación del LLM ("creo que he terminado"). Se comprueba, en orden,
 * `.agente/prd.json` (`status: "done"`) -> `.agente/progress.txt` (línea
 * `DONE`) -> `.agente/plan.md` (sin checkboxes `- [ ]` pendientes). Si
 * ninguno existe, la tarea se considera pendiente.
 */
export async function checkDoneCondition(workspacePath: string): Promise<DoneConditionResult> {
  const agenteDir = join(workspacePath, ".agente");

  const prdRaw = await tryRead(join(agenteDir, "prd.json"));
  if (prdRaw !== undefined) {
    const parsed: unknown = JSON.parse(prdRaw);
    const status = typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>).status : undefined;
    return { done: status === "done", source: "prd.json" };
  }

  const progressRaw = await tryRead(join(agenteDir, "progress.txt"));
  if (progressRaw !== undefined) {
    return { done: /^DONE$/m.test(progressRaw), source: "progress.txt" };
  }

  const planRaw = await tryRead(join(agenteDir, "plan.md"));
  if (planRaw !== undefined) {
    return { done: planRaw.includes("- [") && !planRaw.includes("- [ ]"), source: "plan.md" };
  }

  return { done: false, source: "none" };
}
