import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import { defineTool } from "../registry.js";
import { resolveInWorkspace } from "../filesystem/path-guard.js";

function checkpointPath(workspacePath: string, sessionId: string, checkpointId: string): string {
  return resolveInWorkspace(workspacePath, join(".agente", "checkpoints", sessionId, `${checkpointId}.json`));
}

const SaveInput = z.object({
  workspacePath: z.string(),
  sessionId: z.string(),
  checkpointId: z.string(),
  snapshot: z.record(z.unknown())
});
const SaveOutput = z.object({ path: z.string() });

export const SessionCheckpointSave = defineTool({
  name: "Session_Checkpoint_Save",
  description: "Guarda un snapshot JSON de la sesión bajo .agente/checkpoints/<sessionId>/<checkpointId>.json.",
  inputSchema: SaveInput,
  outputSchema: SaveOutput,
  handler: async ({ workspacePath, sessionId, checkpointId, snapshot }) => {
    const abs = checkpointPath(workspacePath, sessionId, checkpointId);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, JSON.stringify(snapshot, null, 2), "utf8");
    return { path: abs };
  }
});

const LoadInput = z.object({ workspacePath: z.string(), sessionId: z.string(), checkpointId: z.string() });
const LoadOutput = z.record(z.unknown());

export const SessionCheckpointLoad = defineTool({
  name: "Session_Checkpoint_Load",
  description: "Carga un snapshot JSON guardado previamente con Session_Checkpoint_Save.",
  inputSchema: LoadInput,
  outputSchema: LoadOutput,
  handler: async ({ workspacePath, sessionId, checkpointId }) => {
    const abs = checkpointPath(workspacePath, sessionId, checkpointId);
    const content = await readFile(abs, "utf8");
    return JSON.parse(content) as Record<string, unknown>;
  }
});
