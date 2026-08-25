import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { AgentSettingsSchema, type AgentSettings } from "@agentev4/shared";

export function agentSettingsPath(workspacePath: string): string {
  return join(workspacePath, ".agente", "settings.json");
}

/**
 * Un `.agente/settings.json` ausente es el caso normal (workspace nuevo, o
 * uno que nunca personalizó nada): degrada a los defaults en vez de fallar,
 * igual que `connectConfiguredMcpServers` con un `mcp.json` ausente.
 */
export async function loadAgentSettings(workspacePath: string): Promise<AgentSettings> {
  try {
    const raw = await readFile(agentSettingsPath(workspacePath), "utf8");
    return AgentSettingsSchema.parse(JSON.parse(raw));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}

/**
 * Nunca acepta ni escribe claves de proveedor: ver `AgentSettingsSchema`.
 * No asume que `.agente/` ya existe -- `switchWorkspace` lo crea al abrir el
 * workspace, pero este módulo no depende de ese orden de llamada.
 */
export async function saveAgentSettings(
  workspacePath: string,
  input: unknown
): Promise<AgentSettings> {
  const parsed = AgentSettingsSchema.parse(input);
  await mkdir(join(workspacePath, ".agente"), { recursive: true });
  await writeFile(agentSettingsPath(workspacePath), JSON.stringify(parsed, null, 2), "utf8");
  return parsed;
}
