import { readFile } from "node:fs/promises";
import { join } from "node:path";

export function rulesPath(workspacePath: string): string {
  return join(workspacePath, ".agente", "rules.md");
}

/**
 * Lee `.agente/rules.md` para inyectarlo en el prompt de sistema del turno
 * (Fase 3). Un `rules.md` ausente es el caso normal en la mayoría de
 * workspaces -- degrada a cadena vacía en vez de fallar, igual que
 * `connectConfiguredMcpServers` con un `mcp.json` ausente.
 */
export async function loadWorkspaceRules(workspacePath: string): Promise<string> {
  try {
    return await readFile(rulesPath(workspacePath), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  }
}
