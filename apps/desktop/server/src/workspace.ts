import { mkdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { type DatabaseHandle, SessionManager, openDatabase } from "@agentev4/core";
import type { SessionConfig } from "@agentev4/shared";

export interface WorkspaceState {
  workspacePath?: string;
  dbHandle?: DatabaseHandle;
  sessionManager?: SessionManager;
}

export async function switchWorkspace(
  state: WorkspaceState,
  rawPath: unknown
): Promise<{ workspacePath: string; sessions: SessionConfig[] }> {
  if (typeof rawPath !== "string" || rawPath.trim() === "") {
    throw new Error("La ruta del workspace es obligatoria.");
  }

  const workspacePath = resolve(rawPath);
  const info = await stat(workspacePath);
  if (!info.isDirectory()) throw new Error(`La ruta "${workspacePath}" no es una carpeta.`);

  await mkdir(join(workspacePath, ".agente"), { recursive: true });

  const nextHandle = openDatabase(join(workspacePath, ".agente", "sessions.db"));
  let nextManager: SessionManager;
  let sessions: SessionConfig[];
  try {
    nextManager = new SessionManager(nextHandle.db);
    sessions = nextManager.listSessions();
  } catch (error) {
    nextHandle.close();
    throw error;
  }

  try {
    state.dbHandle?.close();
  } catch (error) {
    nextHandle.close();
    throw error;
  }

  state.workspacePath = workspacePath;
  state.dbHandle = nextHandle;
  state.sessionManager = nextManager;
  return { workspacePath, sessions };
}
