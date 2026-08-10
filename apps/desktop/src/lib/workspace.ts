import type { AgentMessage, AgentMode, PermissionMode, SessionConfig } from "@agentev4/shared";
import { callServer } from "./ipc";

export interface ReadyWorkspace {
  workspacePath: string;
  sessions: SessionConfig[];
  activeSessionId: string;
  messages: AgentMessage[];
  tools: string[];
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
