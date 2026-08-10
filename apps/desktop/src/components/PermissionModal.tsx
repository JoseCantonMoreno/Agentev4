import { ShieldAlert } from "lucide-react";
import { callServer } from "../lib/ipc";
import { useAppState } from "../state/store";

/** Modal HITL (Fase 11) conectado al `canUseTool` de la Fase 3: bloquea hasta que el usuario decide. */
export function PermissionModal() {
  const { state, dispatch } = useAppState();
  const request = state.pendingPermission;
  if (!request) return null;

  async function respond(behavior: "allow" | "deny") {
    if (!request) return;
    await callServer("respondPermission", {
      requestId: request.requestId,
      decision: behavior === "allow" ? { behavior: "allow" } : { behavior: "deny", message: "Denegado por el usuario." }
    });
    dispatch({ type: "PERMISSION_RESOLVED" });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="w-full max-w-md rounded-lg border border-amber-700 bg-neutral-900 p-5 shadow-xl">
        <div className="flex items-center gap-2 text-amber-400">
          <ShieldAlert size={20} />
          <h2 className="text-lg font-semibold">Permiso requerido</h2>
        </div>
        <p className="mt-3 text-sm text-neutral-300">
          El agente quiere ejecutar <span className="font-mono text-neutral-100">{request.toolCall.name}</span>:
        </p>
        <pre className="mt-2 max-h-40 overflow-auto rounded-md bg-neutral-950 p-2 text-xs text-neutral-400">
          {JSON.stringify(request.toolCall.input, null, 2)}
        </pre>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => void respond("deny")}
            className="rounded-md border border-neutral-700 px-3 py-1.5 text-sm hover:bg-neutral-800"
          >
            Denegar
          </button>
          <button
            type="button"
            onClick={() => void respond("allow")}
            className="rounded-md bg-emerald-700 px-3 py-1.5 text-sm hover:bg-emerald-600"
          >
            Permitir
          </button>
        </div>
      </div>
    </div>
  );
}
