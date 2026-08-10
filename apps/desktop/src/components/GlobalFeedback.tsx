import { CheckCircle2, X, XCircle } from "lucide-react";
import { useEffect } from "react";
import { useAppState } from "../state/store";

const SUCCESS_DURATION_MS = 3_000;

export function GlobalFeedback() {
  const { state, dispatch } = useAppState();

  useEffect(() => {
    if (!state.notification) return;

    const timeout = window.setTimeout(() => dispatch({ type: "NOTIFICATION_CLEAR" }), SUCCESS_DURATION_MS);
    return () => window.clearTimeout(timeout);
  }, [dispatch, state.notification]);

  if (!state.notification && !state.error) return null;

  return (
    <div className="fixed right-4 top-4 z-40 flex w-full max-w-sm flex-col gap-2">
      {state.notification && (
        <div role="status" className="flex items-start gap-2 rounded-md border border-emerald-700 bg-emerald-950 px-3 py-2 text-sm text-emerald-100">
          <CheckCircle2 aria-hidden="true" className="mt-0.5 shrink-0 text-emerald-400" size={16} />
          <p className="flex-1">{state.notification.message}</p>
          <button
            type="button"
            aria-label="Cerrar notificación"
            onClick={() => dispatch({ type: "NOTIFICATION_CLEAR" })}
            className="text-emerald-200 hover:text-white"
          >
            <X aria-hidden="true" size={16} />
          </button>
        </div>
      )}

      {state.error && (
        <div role="alert" className="flex items-start gap-2 rounded-md border border-red-800 bg-red-950 px-3 py-2 text-sm text-red-100">
          <XCircle aria-hidden="true" className="mt-0.5 shrink-0 text-red-400" size={16} />
          <p className="flex-1">{state.error}</p>
          <button
            type="button"
            aria-label="Cerrar error"
            onClick={() => dispatch({ type: "ERROR_CLEAR" })}
            className="text-red-200 hover:text-white"
          >
            <X aria-hidden="true" size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
