import { KeyRound, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { AgentMode, LlmProviderName, PermissionMode } from "@agentev4/shared";
import { callServer } from "../lib/ipc";
import { useAppState } from "../state/store";

const PROVIDERS: LlmProviderName[] = ["anthropic", "openai", "gemini", "ollama", "openrouter", "groq"];
const AGENT_MODES: AgentMode[] = ["assistant", "agent", "plan"];
const PERMISSION_MODES: PermissionMode[] = ["default", "dontAsk", "acceptEdits", "plan", "bypassPermissions", "auto"];

export function SettingsPanel() {
  const { state, dispatch } = useAppState();
  const [apiKey, setApiKey] = useState("");
  const [hasKey, setHasKey] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!state.settingsOpen) return;
    callServer<{ hasKey: boolean }>("hasApiKey", { provider: state.providerConfig.provider })
      .then((result) => setHasKey(result.hasKey))
      .catch(() => setHasKey(false));
  }, [state.settingsOpen, state.providerConfig.provider]);

  if (!state.settingsOpen) return null;

  async function handleSaveKey() {
    if (!apiKey) return;
    await callServer("setApiKey", { provider: state.providerConfig.provider, apiKey });
    setApiKey("");
    setHasKey(true);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/50">
      <div className="flex h-full w-96 flex-col gap-5 overflow-y-auto border-l border-neutral-800 bg-neutral-950 p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Ajustes</h2>
          <button type="button" onClick={() => dispatch({ type: "SETTINGS_TOGGLE" })} className="text-neutral-400 hover:text-neutral-100">
            <X size={18} />
          </button>
        </div>

        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-medium text-neutral-300">Proveedor LLM</h3>
          <select
            value={state.providerConfig.provider}
            onChange={(event) =>
              dispatch({ type: "PROVIDER_CONFIG_SET", config: { provider: event.target.value as LlmProviderName } })
            }
            className="rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm"
          >
            {PROVIDERS.map((provider) => (
              <option key={provider} value={provider}>
                {provider}
              </option>
            ))}
          </select>
          <input
            value={state.providerConfig.model}
            onChange={(event) => dispatch({ type: "PROVIDER_CONFIG_SET", config: { model: event.target.value } })}
            placeholder="Modelo (ej. claude-sonnet-5)"
            className="rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm"
          />
          <input
            value={state.providerConfig.baseUrl}
            onChange={(event) => dispatch({ type: "PROVIDER_CONFIG_SET", config: { baseUrl: event.target.value } })}
            placeholder="Base URL (opcional, ollama/openrouter/groq)"
            className="rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm"
          />

          <div className="flex items-center gap-2">
            <KeyRound size={14} className={hasKey ? "text-emerald-500" : "text-neutral-500"} />
            <input
              type="password"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder={hasKey ? "Clave configurada (RAM) — sobrescribir" : "API key"}
              className="min-w-0 flex-1 rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm"
            />
            <button
              type="button"
              onClick={() => void handleSaveKey()}
              className="rounded-md bg-emerald-700 px-2 py-1 text-sm hover:bg-emerald-600"
            >
              {saved ? "OK" : "Guardar"}
            </button>
          </div>
        </section>

        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-medium text-neutral-300">Valores por defecto para nuevas sesiones</h3>
          <select
            value={state.defaultMode}
            onChange={(event) => dispatch({ type: "DEFAULTS_SET", mode: event.target.value as AgentMode })}
            className="rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm"
          >
            {AGENT_MODES.map((mode) => (
              <option key={mode} value={mode}>
                {mode}
              </option>
            ))}
          </select>
          <select
            value={state.defaultPermissionMode}
            onChange={(event) => dispatch({ type: "DEFAULTS_SET", permissionMode: event.target.value as PermissionMode })}
            className="rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm"
          >
            {PERMISSION_MODES.map((mode) => (
              <option key={mode} value={mode}>
                {mode}
              </option>
            ))}
          </select>
        </section>

        <section className="flex flex-1 flex-col gap-2">
          <h3 className="text-sm font-medium text-neutral-300">Herramientas activas</h3>
          <ul className="flex flex-col gap-1">
            {state.availableTools.map((tool) => (
              <li key={tool} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={!state.disabledTools.has(tool)}
                  onChange={() => dispatch({ type: "TOOL_TOGGLED", tool })}
                />
                <span className="font-mono text-xs">{tool}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
