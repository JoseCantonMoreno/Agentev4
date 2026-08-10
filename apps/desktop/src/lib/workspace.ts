import {
  AgentMessageSchema,
  SessionConfigSchema,
  type AgentMessage,
  type AgentMode,
  type PermissionMode,
  type SessionConfig
} from "@agentev4/shared";
import { callServer } from "./ipc";

export interface ReadyWorkspace {
  workspacePath: string;
  sessions: SessionConfig[];
  activeSessionId: string;
  messages: AgentMessage[];
  tools: string[];
}

export type WorkspaceLifecycleAction =
  | { type: "WORKSPACE_SELECTION_STARTED" }
  | { type: "WORKSPACE_SELECTION_CANCELLED" }
  | { type: "WORKSPACE_PREPARING" }
  | { type: "WORKSPACE_READY"; ready: ReadyWorkspace }
  | { type: "WORKSPACE_PREPARATION_FAILED"; error: string };

export interface WorkspaceSelectionController {
  select(): Promise<void> | undefined;
}

function parseReadyWorkspace(value: unknown): ReadyWorkspace {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("El servidor devolvió un workspace inválido.");
  }

  const candidate = value as Record<string, unknown>;
  if (typeof candidate.workspacePath !== "string") {
    throw new Error("El servidor devolvió una ruta de workspace inválida.");
  }
  if (typeof candidate.activeSessionId !== "string") {
    throw new Error("El servidor devolvió una sesión activa inválida.");
  }
  if (
    !Array.isArray(candidate.tools) ||
    !candidate.tools.every((tool) => typeof tool === "string")
  ) {
    throw new Error("El servidor devolvió un catálogo de herramientas inválido.");
  }

  const sessions = SessionConfigSchema.array().parse(candidate.sessions);
  const messages = AgentMessageSchema.array().parse(candidate.messages);
  if (!sessions.some((session) => session.id === candidate.activeSessionId)) {
    throw new Error("La sesión activa no pertenece al workspace preparado.");
  }

  return {
    workspacePath: candidate.workspacePath,
    sessions,
    activeSessionId: candidate.activeSessionId,
    messages,
    tools: candidate.tools
  };
}

export async function prepareWorkspace(input: {
  workspacePath: string;
  defaultMode: AgentMode;
  defaultPermissionMode: PermissionMode;
  call?: typeof callServer;
}): Promise<ReadyWorkspace> {
  const call = input.call ?? callServer;
  const ready = await call<unknown>("initWorkspace", {
    workspacePath: input.workspacePath,
    defaultMode: input.defaultMode,
    defaultPermissionMode: input.defaultPermissionMode
  });
  return parseReadyWorkspace(ready);
}

export async function listWorkspaceSessions(
  call: typeof callServer = callServer
): Promise<SessionConfig[]> {
  return SessionConfigSchema.array().parse(await call<unknown>("listSessions"));
}

export async function createWorkspaceSession(
  input: {
    name: string;
    mode: AgentMode;
    permissionMode: PermissionMode;
  },
  call: typeof callServer = callServer
): Promise<SessionConfig> {
  return SessionConfigSchema.parse(await call<unknown>("createSession", input));
}

export async function listSessionMessages(
  sessionId: string,
  call: typeof callServer = callServer
): Promise<AgentMessage[]> {
  return AgentMessageSchema.array().parse(await call<unknown>("listMessages", { sessionId }));
}

export function createWorkspaceSelectionController(input: {
  selectWorkspaceFolder: () => Promise<string | null>;
  defaultMode: () => AgentMode;
  defaultPermissionMode: () => PermissionMode;
  prepare?: typeof prepareWorkspace;
  dispatch: (action: WorkspaceLifecycleAction) => void;
}): WorkspaceSelectionController {
  let selectionInFlight = false;
  const prepare = input.prepare ?? prepareWorkspace;

  async function runSelection(): Promise<void> {
    input.dispatch({ type: "WORKSPACE_SELECTION_STARTED" });
    try {
      const workspacePath = await input.selectWorkspaceFolder();
      if (!workspacePath) {
        input.dispatch({ type: "WORKSPACE_SELECTION_CANCELLED" });
        return;
      }

      input.dispatch({ type: "WORKSPACE_PREPARING" });
      const ready = await prepare({
        workspacePath,
        defaultMode: input.defaultMode(),
        defaultPermissionMode: input.defaultPermissionMode()
      });
      input.dispatch({ type: "WORKSPACE_READY", ready });
    } catch (error) {
      input.dispatch({
        type: "WORKSPACE_PREPARATION_FAILED",
        error: error instanceof Error ? error.message : String(error)
      });
    } finally {
      selectionInFlight = false;
    }
  }

  return {
    select() {
      if (selectionInFlight) return undefined;
      selectionInFlight = true;
      return runSelection();
    }
  };
}
