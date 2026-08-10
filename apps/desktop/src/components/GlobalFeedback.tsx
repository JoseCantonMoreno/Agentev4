import { CheckCircle2, X, XCircle } from "lucide-react";
import { useEffect } from "react";
import { useAppState } from "../state/store";

const SUCCESS_DURATION_MS = 3_000;

export function GlobalFeedback() {
  const { state, dispatch } = useAppState();
  const notification = state.notification;

  useEffect(() => {
    if (!notification) return;

    const timeout = window.setTimeout(
      () => dispatch({ type: "NOTIFICATION_CLEAR", id: notification.id }),
      SUCCESS_DURATION_MS
    );
    return () => window.clearTimeout(timeout);
  }, [dispatch, notification]);

  if (!notification && !state.error) return null;

  return (
    <div className="fixed right-4 top-4 z-40 flex w-full max-w-sm flex-col gap-2">
      {notification && (
        <div role="status" className="flex items-start gap-2 rounded-md border border-emerald-700 bg-emerald-950 px-3 py-2 text-sm text-emerald-100">
          <CheckCircle2 aria-hidden="true" className="mt-0.5 shrink-0 text-emerald-400" size={16} />
          <p className="flex-1">{notification.message}</p>
          <button
            type="button"
            aria-label="Cerrar notificación"
            onClick={() => dispatch({ type: "NOTIFICATION_CLEAR", id: notification.id })}
            className="text-emerald-200 hover:text-white"
          >
            <X aria-hidden="true" size={16} />
          </button>
        </div>
      )}

      {state.error && (
        <div role="alert" className="flex items-start gap-2 rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100">
          <XCircle aria-hidden="true" className="mt-0.5 shrink-0 text-emerald-400" size={16} />
          <p className="flex-1">{state.error}</p>
          <button
            type="button"
            aria-label="Cerrar error"
            onClick={() => dispatch({ type: "ERROR_CLEAR" })}
            className="text-neutral-300 hover:text-white"
          >
            <X aria-hidden="true" size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
