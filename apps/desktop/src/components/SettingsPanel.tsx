import { KeyRound, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type {
  AgentMode,
  LlmProviderName,
  PermissionMode,
  SavedProviderSettings
} from "@agentev4/shared";
import { callServer } from "../lib/ipc";
import { useAppState } from "../state/store";

const PROVIDERS: LlmProviderName[] = [
  "anthropic",
  "openai",
  "gemini",
  "ollama",
  "openrouter",
  "groq"
];
const AGENT_MODES: AgentMode[] = ["assistant", "agent", "plan"];
const PERMISSION_MODES: PermissionMode[] = [
  "default",
  "dontAsk",
  "acceptEdits",
  "plan",
  "bypassPermissions",
  "auto"
];

interface ProviderDraft {
  provider: LlmProviderName;
  model: string;
  baseUrl: string;
  apiKey: string;
}

interface PreservedApiKey {
  provider: LlmProviderName;
  value: string;
}

export function SettingsPanel() {
  const { state, dispatch } = useAppState();
  const [draft, setDraft] = useState<ProviderDraft>({ ...state.providerConfig, apiKey: "" });
  const [hasKey, setHasKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const hasKeyRequest = useRef(0);
  const savingRef = useRef(false);
  const observedServerEpoch = useRef(state.serverEpoch);
  const apiKeyDraftRef = useRef<PreservedApiKey | null>(null);

  useEffect(() => {
    if (!state.settingsOpen) {
      observedServerEpoch.current = state.serverEpoch;
      return;
    }
    const serverChanged = observedServerEpoch.current !== state.serverEpoch;
    observedServerEpoch.current = state.serverEpoch;
    if (!serverChanged) apiKeyDraftRef.current = null;
    hasKeyRequest.current += 1;
    setHasKey(false);
    setDraft({ ...state.providerConfig, apiKey: "" });
  }, [state.serverEpoch, state.settingsOpen]);

  useEffect(() => {
    if (!state.settingsOpen) return;
    const requestId = ++hasKeyRequest.current;
    callServer("hasApiKey", { provider: draft.provider })
      .then((result) => {
        if (requestId === hasKeyRequest.current) setHasKey(result.hasKey);
      })
      .catch(() => {
        if (requestId === hasKeyRequest.current) setHasKey(false);
      });
  }, [draft.provider, state.serverEpoch, state.settingsOpen]);

  if (!state.settingsOpen) return null;

  async function handleSave() {
    if (savingRef.current) return;
    const model = draft.model.trim();
    if (!model) {
      dispatch({ type: "ERROR_SET", error: "El modelo es obligatorio." });
      return;
    }

    const apiKey =
      apiKeyDraftRef.current?.provider === draft.provider
        ? apiKeyDraftRef.current.value.trim()
        : "";
    savingRef.current = true;
    setSaving(true);
    dispatch({ type: "ERROR_SET", error: null });
    try {
      const result: SavedProviderSettings = await callServer("saveProviderSettings", {
        provider: draft.provider,
        model,
        baseUrl: draft.baseUrl.trim(),
        ...(apiKey ? { apiKey } : {})
      });
      const committedConfig = { ...result.config, baseUrl: result.config.baseUrl ?? "" };
      dispatch({
        type: "PROVIDER_CONFIG_COMMITTED",
        config: committedConfig
      });
      hasKeyRequest.current += 1;
      apiKeyDraftRef.current = null;
      setDraft({ ...committedConfig, apiKey: "" });
      setHasKey(result.hasApiKey);
      dispatch({
        type: "NOTIFICATION_SET",
        notification: {
          id: crypto.randomUUID(),
          kind: "success",
          message: "Configuración guardada correctamente"
        }
      });
    } catch (error) {
      dispatch({
        type: "ERROR_SET",
        error: error instanceof Error ? error.message : String(error)
      });
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  function handleProviderChange(provider: LlmProviderName) {
    hasKeyRequest.current += 1;
    setHasKey(false);
    if (apiKeyDraftRef.current?.provider !== provider) apiKeyDraftRef.current = null;
    setDraft((current) => ({ ...current, provider }));
  }

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/50">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        className="flex h-full w-96 flex-col gap-5 overflow-y-auto border-l border-neutral-800 bg-neutral-950 p-4"
      >
        <div className="flex items-center justify-between">
          <h2 id="settings-title" className="text-lg font-semibold">
            Ajustes
          </h2>
          <button
            type="button"
            aria-label="Cerrar ajustes"
            onClick={() => dispatch({ type: "SETTINGS_TOGGLE" })}
            className="text-neutral-400 hover:text-neutral-100"
          >
            <X size={18} />
          </button>
        </div>

        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-medium text-neutral-300">Proveedor LLM</h3>
          <label htmlFor="provider" className="text-sm text-neutral-300">
            Proveedor
          </label>
          <select
            id="provider"
            value={draft.provider}
            onChange={(event) => handleProviderChange(event.target.value as LlmProviderName)}
            disabled={saving}
            className="rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm"
          >
            {PROVIDERS.map((provider) => (
              <option key={provider} value={provider}>
                {provider}
              </option>
            ))}
          </select>
          <label htmlFor="model" className="text-sm text-neutral-300">
            Modelo
          </label>
          <input
            id="model"
            value={draft.model}
            onChange={(event) => setDraft((current) => ({ ...current, model: event.target.value }))}
            disabled={saving}
            placeholder="Modelo (ej. claude-sonnet-5)"
            className="rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm"
          />
          <label htmlFor="base-url" className="text-sm text-neutral-300">
            Base URL
          </label>
          <input
            id="base-url"
            value={draft.baseUrl}
            onChange={(event) =>
              setDraft((current) => ({ ...current, baseUrl: event.target.value }))
            }
            disabled={saving}
            placeholder="Base URL (opcional, ollama/openrouter/groq)"
            className="rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm"
          />
          <div className="flex items-center gap-2">
            <KeyRound size={14} className={hasKey ? "text-emerald-500" : "text-neutral-500"} />
            <label htmlFor="api-key" className="sr-only">
              API key
            </label>
            <input
              id="api-key"
              type="password"
              value={draft.apiKey}
              onChange={(event) => {
                apiKeyDraftRef.current = {
                  provider: draft.provider,
                  value: event.target.value
                };
                setDraft((current) => ({ ...current, apiKey: event.target.value }));
              }}
              disabled={saving}
              placeholder={hasKey ? "Clave configurada (RAM) — sobrescribir" : "API key"}
              className="min-w-0 flex-1 rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm"
            />
          </div>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving}
            className="rounded-md bg-emerald-700 px-2 py-1 text-sm hover:bg-emerald-600 disabled:opacity-50"
          >
            {saving ? "Guardando…" : "Guardar configuración"}
          </button>
        </section>

        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-medium text-neutral-300">
            Valores por defecto para nuevas sesiones
          </h3>
          <select
            value={state.defaultMode}
            onChange={(event) =>
              dispatch({ type: "DEFAULTS_SET", mode: event.target.value as AgentMode })
            }
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
            onChange={(event) =>
              dispatch({
                type: "DEFAULTS_SET",
                permissionMode: event.target.value as PermissionMode
              })
            }
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
