import type { AgentMessage, AgentMode, PermissionMode, SessionConfig } from "@agentev4/shared";
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

interface InitializedWorkspace {
  workspacePath: string;
  sessions: SessionConfig[];
}

function compareSessions(left: SessionConfig, right: SessionConfig): number {
  const updatedAtDifference = right.updatedAt.getTime() - left.updatedAt.getTime();
  if (updatedAtDifference !== 0) return updatedAtDifference;

  const createdAtDifference = right.createdAt.getTime() - left.createdAt.getTime();
  if (createdAtDifference !== 0) return createdAtDifference;

  return left.id.localeCompare(right.id);
}

export async function prepareWorkspace(input: {
  workspacePath: string;
  defaultMode: AgentMode;
  defaultPermissionMode: PermissionMode;
  call?: typeof callServer;
}): Promise<ReadyWorkspace> {
  const call = input.call ?? callServer;
  const initialized = await call<InitializedWorkspace>("initWorkspace", {
    workspacePath: input.workspacePath
  });
  let sessions = [...initialized.sessions].sort(compareSessions);

  if (sessions.length === 0) {
    const created = await call<SessionConfig>("createSession", {
      name: "Sesi\u00f3n de prueba",
      mode: input.defaultMode,
      permissionMode: input.defaultPermissionMode
    });
    sessions = [created];
  }

  const activeSessionId = sessions[0]!.id;
  const [tools, messages] = await Promise.all([
    call<string[]>("listTools"),
    call<AgentMessage[]>("listMessages", { sessionId: activeSessionId })
  ]);

  return {
    workspacePath: initialized.workspacePath,
    sessions,
    activeSessionId,
    messages,
    tools
  };
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
