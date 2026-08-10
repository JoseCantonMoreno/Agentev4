import { Gauge } from "lucide-react";
import { useAppState } from "../state/store";

export function ContextGauge() {
  const { state } = useAppState();
  if (!state.context) return null;

  const ratio = Math.min(1, state.context.usedTokens / state.context.maxTokens);
  const percent = Math.round(ratio * 100);
  const barColor = ratio >= 0.8 ? "bg-red-500" : ratio >= 0.5 ? "bg-amber-500" : "bg-emerald-500";

  return (
    <div className="flex items-center gap-2 text-xs text-neutral-300">
      <Gauge size={14} />
      <div className="h-2 w-40 overflow-hidden rounded-full bg-neutral-800">
        <div className={`h-full ${barColor}`} style={{ width: `${percent}%` }} />
      </div>
      <span>
        {state.context.usedTokens.toLocaleString()} / {state.context.maxTokens.toLocaleString()} tokens ({percent}%)
      </span>
    </div>
  );
}
