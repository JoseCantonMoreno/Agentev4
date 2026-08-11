import { History, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import type { SessionConfig } from "@agentev4/shared";
import { callServer } from "../lib/ipc";
import {
  createWorkspaceSession,
  listSessionMessages,
  listWorkspaceSessions
} from "../lib/workspace";
import { useAppState } from "../state/store";

async function activateSession(
  sessionId: string,
  dispatch: ReturnType<typeof useAppState>["dispatch"]
) {
  const messages = await listSessionMessages(sessionId);
  dispatch({ type: "SESSION_ACTIVATED", sessionId, messages });
}

export function SessionPanel() {
  const { state, dispatch } = useAppState();
  const [newName, setNewName] = useState("");
  const [checkpoints, setCheckpoints] = useState<string[]>([]);

  async function refreshSessions() {
    const sessions = await listWorkspaceSessions();
    dispatch({ type: "SESSIONS_SET", sessions });
  }

  async function handleCreate() {
    if (state.sending) return;
    const name = newName.trim() || `Sesión ${state.sessions.length + 1}`;
    const created = await createWorkspaceSession({
      name,
      mode: state.defaultMode,
      permissionMode: state.defaultPermissionMode
    });
    setNewName("");
    await refreshSessions();
    await activateSession(created.id, dispatch);
  }

  async function handleSelect(sessionId: string) {
    if (state.sending) return;
    await activateSession(sessionId, dispatch);
    const list = await callServer("listCheckpoints", { sessionId });
    setCheckpoints(list);
  }

  async function handleRename(session: SessionConfig) {
    if (state.sending) return;
    const name = window.prompt("Nuevo nombre de la sesión", session.name);
    if (!name || name === session.name) return;
    await callServer("renameSession", { sessionId: session.id, name });
    await refreshSessions();
  }

  async function handleDelete(session: SessionConfig) {
    if (state.sending) return;
    if (!window.confirm(`¿Eliminar la sesión "${session.name}"? Esta acción no se puede deshacer.`))
      return;
    await callServer("deleteSession", { sessionId: session.id });
    if (state.activeSessionId === session.id)
      dispatch({ type: "SESSION_ACTIVATED", sessionId: null, messages: [] });
    await refreshSessions();
  }

  if (!state.workspacePath) return null;

  return (
    <div className="flex flex-1 flex-col gap-3 overflow-y-auto">
      <div className="flex gap-2">
        <input
          value={newName}
          disabled={state.sending}
          onChange={(event) => setNewName(event.target.value)}
          placeholder="Nombre de la nueva sesión"
          className="min-w-0 flex-1 rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm"
        />
        <button
          type="button"
          onClick={() => void handleCreate()}
          disabled={state.sending}
          className="flex items-center gap-1 rounded-md bg-emerald-700 px-2 py-1 text-sm hover:bg-emerald-600"
        >
          <Plus size={14} /> Nueva
        </button>
      </div>

      <ul className="flex flex-1 flex-col gap-1 overflow-y-auto">
        {state.sessions.map((session) => (
          <li
            key={session.id}
            className={`rounded-md border px-2 py-2 text-sm ${
              session.id === state.activeSessionId
                ? "border-emerald-600 bg-emerald-950/40"
                : "border-neutral-800 bg-neutral-900"
            }`}
          >
            <button
              type="button"
              onClick={() => void handleSelect(session.id)}
              disabled={state.sending}
              className="block w-full text-left disabled:opacity-50"
            >
              <div className="truncate font-medium">{session.name}</div>
              <div className="text-xs text-neutral-400">
                {session.mode} · {session.permissionMode} · {session.tokensUsed} tokens
              </div>
            </button>
            <div className="mt-1 flex gap-2 text-neutral-400">
              <button
                type="button"
                onClick={() => void handleRename(session)}
                disabled={state.sending}
                title="Renombrar"
                className="hover:text-neutral-100 disabled:opacity-50"
              >
                <Pencil size={13} />
              </button>
              <button
                type="button"
                onClick={() => void handleDelete(session)}
                disabled={state.sending}
                title="Eliminar"
                className="hover:text-red-400 disabled:opacity-50"
              >
                <Trash2 size={13} />
              </button>
            </div>
            {session.id === state.activeSessionId && checkpoints.length > 0 && (
              <div className="mt-2 flex items-center gap-1 text-xs text-neutral-400">
                <History size={12} />
                {checkpoints.length} checkpoint(s)
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
