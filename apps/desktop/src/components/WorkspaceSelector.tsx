import { FolderOpen } from "lucide-react";
import { useState } from "react";
import { selectWorkspaceFolder } from "../lib/dialog";
import { callServer } from "../lib/ipc";
import { useAppState } from "../state/store";
import type { SessionConfig } from "@agentev4/shared";

export function WorkspaceSelector() {
  const { state, dispatch } = useAppState();
  const [opening, setOpening] = useState(false);

  async function handleSelect() {
    setOpening(true);
    dispatch({ type: "ERROR_SET", error: null });
    try {
      const workspacePath = await selectWorkspaceFolder();
      if (!workspacePath) return;

      const result = await callServer<{ workspacePath: string; sessions: SessionConfig[] }>("initWorkspace", {
        workspacePath
      });
      dispatch({ type: "WORKSPACE_LOADED", workspacePath: result.workspacePath, sessions: result.sessions });
      const tools = await callServer<string[]>("listTools");
      dispatch({ type: "TOOLS_SET", tools });
    } catch (error) {
      dispatch({ type: "ERROR_SET", error: error instanceof Error ? error.message : String(error) });
    } finally {
      setOpening(false);
    }
  }

  return (
    <button
      type="button"
      onClick={() => void handleSelect()}
      disabled={opening}
      className="flex w-full items-center gap-2 rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-200 hover:bg-neutral-800 disabled:opacity-50"
    >
      <FolderOpen size={16} />
      <span className="truncate">
        {state.workspacePath ? state.workspacePath : opening ? "Abriendo workspace…" : "Seleccionar carpeta de workspace"}
      </span>
    </button>
  );
}
