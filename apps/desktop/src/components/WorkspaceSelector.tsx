import { FolderOpen } from "lucide-react";
import { useState } from "react";
import { selectWorkspaceFolder } from "../lib/dialog";
import { prepareWorkspace } from "../lib/workspace";
import { useAppState } from "../state/store";

export function WorkspaceSelector() {
  const { state, dispatch } = useAppState();
  const [opening, setOpening] = useState(false);

  async function handleSelect() {
    setOpening(true);
    dispatch({ type: "WORKSPACE_SELECTION_STARTED" });
    try {
      const workspacePath = await selectWorkspaceFolder();
      if (!workspacePath) {
        dispatch({ type: "WORKSPACE_SELECTION_CANCELLED" });
        return;
      }

      dispatch({ type: "WORKSPACE_PREPARING" });
      const ready = await prepareWorkspace({
        workspacePath,
        defaultMode: state.defaultMode,
        defaultPermissionMode: state.defaultPermissionMode
      });
      dispatch({ type: "WORKSPACE_READY", ready });
    } catch (error) {
      dispatch({
        type: "WORKSPACE_PREPARATION_FAILED",
        error: error instanceof Error ? error.message : String(error)
      });
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
