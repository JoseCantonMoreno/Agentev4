import { mkdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { type DatabaseHandle, SessionManager, openDatabase } from "@agentev4/core";
import type { AgentMessage, AgentMode, PermissionMode, SessionConfig } from "@agentev4/shared";

export interface WorkspaceState {
  workspacePath?: string;
  dbHandle?: DatabaseHandle;
  sessionManager?: SessionManager;
}

export interface ReadyWorkspace {
  workspacePath: string;
  sessions: SessionConfig[];
  activeSessionId: string;
  messages: AgentMessage[];
  tools: string[];
}

export interface WorkspacePreparation {
  defaultMode: AgentMode;
  defaultPermissionMode: PermissionMode;
  listTools: () => Promise<string[]> | string[];
  beforeCommit?: () => void;
}

function compareSessions(left: SessionConfig, right: SessionConfig): number {
  const updatedAtDifference = right.updatedAt.getTime() - left.updatedAt.getTime();
  if (updatedAtDifference !== 0) return updatedAtDifference;

  const createdAtDifference = right.createdAt.getTime() - left.createdAt.getTime();
  if (createdAtDifference !== 0) return createdAtDifference;

  return left.id.localeCompare(right.id);
}

function ensureSession(
  manager: SessionManager,
  sessions: SessionConfig[],
  workspacePath: string,
  preparation: WorkspacePreparation
): SessionConfig[] {
  if (sessions.length > 0) return [...sessions].sort(compareSessions);

  return [
    manager.createSession({
      name: "Sesión de prueba",
      workspacePath,
      mode: preparation.defaultMode,
      permissionMode: preparation.defaultPermissionMode
    })
  ];
}

export async function switchWorkspace(
  state: WorkspaceState,
  rawPath: string,
  preparation: WorkspacePreparation
): Promise<ReadyWorkspace> {
  const workspacePath = resolve(rawPath);
  const info = await stat(workspacePath);
  if (!info.isDirectory()) throw new Error(`La ruta "${workspacePath}" no es una carpeta.`);

  await mkdir(join(workspacePath, ".agente"), { recursive: true });

  const nextHandle = openDatabase(join(workspacePath, ".agente", "sessions.db"));
  let committed = false;
  try {
    const nextManager = new SessionManager(nextHandle.db);
    const sessions = ensureSession(
      nextManager,
      nextManager.listSessions(),
      workspacePath,
      preparation
    );
    const activeSessionId = sessions[0]!.id;
    const messages = nextManager.listMessages(activeSessionId);
    const tools = await preparation.listTools();
    const ready = { workspacePath, sessions, activeSessionId, messages, tools };

    preparation.beforeCommit?.();
    state.dbHandle?.close();
    state.workspacePath = workspacePath;
    state.dbHandle = nextHandle;
    state.sessionManager = nextManager;
    committed = true;
    return ready;
  } finally {
    if (!committed) nextHandle.close();
  }
}
