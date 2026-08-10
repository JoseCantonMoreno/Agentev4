import { Send, Wrench } from "lucide-react";
import { useState } from "react";
import type { AgentMessage } from "@agentev4/shared";
import { callServer } from "../lib/ipc";
import { useAppState } from "../state/store";

export function ChatPanel() {
  const { state, dispatch } = useAppState();
  const [prompt, setPrompt] = useState("");

  async function handleSend() {
    if (!prompt.trim() || !state.activeSessionId || state.sending) return;
    const sessionId = state.activeSessionId;
    const text = prompt.trim();
    setPrompt("");
    dispatch({ type: "SENDING_SET", sending: true });
    dispatch({ type: "ERROR_SET", error: null });
    try {
      await callServer("sendPrompt", {
        sessionId,
        prompt: text,
        disabledTools: Array.from(state.disabledTools)
      });
      const messages = await callServer<AgentMessage[]>("listMessages", { sessionId });
      dispatch({ type: "MESSAGES_SET", messages });
    } catch (error) {
      dispatch({
        type: "ERROR_SET",
        error: error instanceof Error ? error.message : String(error)
      });
    } finally {
      dispatch({ type: "SENDING_SET", sending: false });
    }
  }

  if (state.workspaceStatus === "idle") {
    return (
      <div className="flex flex-1 items-center justify-center text-neutral-500">
        Selecciona una carpeta para preparar el agente.
      </div>
    );
  }

  if (state.workspaceStatus === "selecting") {
    return (
      <div className="flex flex-1 items-center justify-center text-neutral-500">
        Seleccionando carpeta…
      </div>
    );
  }

  if (state.workspaceStatus === "preparing") {
    return (
      <div className="flex flex-1 items-center justify-center text-neutral-500">
        Preparando workspace y sesión…
      </div>
    );
  }

  if (!state.activeSessionId) {
    return (
      <div className="flex flex-1 items-center justify-center text-neutral-500">
        Selecciona o crea una sesión para empezar.
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-3 overflow-hidden">
      <div className="flex flex-1 flex-col gap-3 overflow-y-auto rounded-md border border-neutral-800 bg-neutral-900 p-3">
        {state.messages.map((message) => (
          <div
            key={message.id}
            className={`text-sm ${message.role === "user" ? "text-neutral-100" : "text-neutral-300"}`}
          >
            <span className="mr-2 font-semibold uppercase text-neutral-500">{message.role}</span>
            <span className="whitespace-pre-wrap">{message.content}</span>
          </div>
        ))}

        {state.toolCalls.map((event) => (
          <div key={event.toolCall.id} className="flex items-center gap-2 text-xs text-amber-400">
            <Wrench size={12} />
            <span className="font-mono">{event.toolCall.name}</span>
          </div>
        ))}

        {state.thoughts.length > 0 && (
          <div className="rounded-md border border-neutral-800 bg-neutral-950 p-2 text-xs text-neutral-500">
            {state.thoughts.at(-1)}
          </div>
        )}
      </div>
      <div className="flex gap-2">
        <textarea
          autoFocus
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void handleSend();
            }
          }}
          placeholder="Escribe un prompt…"
          rows={2}
          className="min-w-0 flex-1 resize-none rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm"
        />
        <button
          type="button"
          onClick={() => void handleSend()}
          disabled={state.sending}
          className="flex items-center gap-1 self-end rounded-md bg-emerald-700 px-3 py-2 text-sm hover:bg-emerald-600 disabled:opacity-50"
        >
          <Send size={14} />
          {state.sending ? "Enviando…" : "Enviar"}
        </button>
      </div>
    </div>
  );
}
