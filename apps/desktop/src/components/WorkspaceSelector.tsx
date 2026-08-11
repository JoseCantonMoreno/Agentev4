import { FolderOpen } from "lucide-react";
import { useRef, useState } from "react";
import { selectWorkspaceFolder } from "../lib/dialog";
import { createWorkspaceSelectionController } from "../lib/workspace";
import { useAppState } from "../state/store";

export function WorkspaceSelector() {
  const { state, dispatch } = useAppState();
  const [opening, setOpening] = useState(false);
  const defaults = useRef({ mode: state.defaultMode, permissionMode: state.defaultPermissionMode });
  defaults.current = { mode: state.defaultMode, permissionMode: state.defaultPermissionMode };
  const controller = useRef<ReturnType<typeof createWorkspaceSelectionController> | null>(null);

  if (!controller.current) {
    controller.current = createWorkspaceSelectionController({
      selectWorkspaceFolder,
      defaultMode: () => defaults.current.mode,
      defaultPermissionMode: () => defaults.current.permissionMode,
      dispatch
    });
  }

  async function handleSelect() {
    if (
      state.sending ||
      state.workspaceStatus === "selecting" ||
      state.workspaceStatus === "preparing"
    )
      return;
    const selection = controller.current?.select();
    if (!selection) return;

    setOpening(true);
    try {
      await selection;
    } finally {
      setOpening(false);
    }
  }

  return (
    <button
      type="button"
      onClick={() => void handleSelect()}
      disabled={
        opening ||
        state.sending ||
        state.workspaceStatus === "selecting" ||
        state.workspaceStatus === "preparing"
      }
      className="flex w-full items-center gap-2 rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-200 hover:bg-neutral-800 disabled:opacity-50"
    >
      <FolderOpen size={16} />
      <span className="truncate">
        {state.workspaceStatus === "preparing"
          ? "Preparando workspace…"
          : opening || state.workspaceStatus === "selecting"
            ? "Seleccionando workspace…"
            : (state.workspacePath ?? "Seleccionar carpeta de workspace")}
      </span>
    </button>
  );
}
