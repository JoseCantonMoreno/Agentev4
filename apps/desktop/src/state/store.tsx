import { createContext, useContext, useEffect, useMemo, useReducer, type ReactNode } from "react";
import type {
  AgentContextUpdateEvent,
  AgentIpcEvent,
  AgentMessage,
  AgentMode,
  AgentPermissionRequestEvent,
  AgentSettings,
  LlmProviderName,
  PermissionMode,
  SessionConfig,
  ToolCall
} from "@agentev4/shared";
import { onServerEvent, onServerLifecycle } from "../lib/ipc";
import type { WorkspaceLifecycleAction } from "../lib/workspace";

export interface ProviderConfig {
  provider: LlmProviderName;
  model: string;
  baseUrl: string;
}

export interface AppNotification {
  id: string;
  kind: "success";
  message: string;
}

/**
 * Registro cronológico único de lo que el agente va haciendo durante un
 * turno en curso (texto del asistente + tool calls intercalados en el
 * orden real de llegada). Vive solo mientras `sending` es true: se limpia
 * al empezar un prompt nuevo y al llegar el refetch autoritativo de
 * `state.messages`.
 *
 * `assistant_delta` acumula fragmentos consecutivos con el mismo
 * `messageId` en una sola burbuja creciente; un `messageId` distinto abre
 * una entrada nueva (turno siguiente, o reintento tras un fallo transitorio
 * -- ver `AgentMessageDeltaEvent`).
 */
export type ActivityEntry =
  | { kind: "assistant_delta"; messageId: string; content: string }
  | { kind: "tool_call"; toolCall: ToolCall };

export interface AppState {
  workspacePath: string | null;
  workspaceStatus: "idle" | "selecting" | "preparing" | "ready";
  sessions: SessionConfig[];
  activeSessionId: string | null;
  messages: AgentMessage[];
  activity: ActivityEntry[];
  context: AgentContextUpdateEvent | null;
  pendingPermission: AgentPermissionRequestEvent | null;
  settingsOpen: boolean;
  sending: boolean;
  activeRunId: string | null;
  serverEpoch: number;
  error: string | null;
  notification: AppNotification | null;
  providerConfig: ProviderConfig;
  availableTools: string[];
  disabledTools: Set<string>;
  defaultMode: AgentMode;
  defaultPermissionMode: PermissionMode;
  agentSettings: AgentSettings;
}

export type Action =
  | WorkspaceLifecycleAction
  | { type: "SESSIONS_SET"; workspacePath: string; sessions: SessionConfig[] }
  | {
      type: "SESSION_ACTIVATED";
      workspacePath: string;
      sessionId: string | null;
      messages: AgentMessage[];
    }
  | { type: "MESSAGES_SET"; sessionId: string; messages: AgentMessage[] }
  | { type: "SENDING_STARTED"; runId: string }
  | { type: "SENDING_FINISHED"; runId: string }
  | { type: "SERVER_PROCESS_FAILED"; error: string }
  | { type: "SETTINGS_TOGGLE" }
  | { type: "ERROR_SET"; error: string | null }
  | { type: "ERROR_CLEAR" }
  | { type: "NOTIFICATION_SET"; notification: AppNotification }
  | { type: "NOTIFICATION_CLEAR"; id: string }
  | { type: "SERVER_EVENT"; event: AgentIpcEvent }
  | { type: "PERMISSION_RESOLVED" }
  | { type: "PROVIDER_CONFIG_COMMITTED"; config: ProviderConfig }
  | { type: "AGENT_SETTINGS_COMMITTED"; settings: AgentSettings }
  | { type: "TOOLS_SET"; tools: string[] }
  | { type: "TOOL_TOGGLED"; tool: string }
  | { type: "DEFAULTS_SET"; mode?: AgentMode; permissionMode?: PermissionMode };

export const initialState: AppState = {
  workspacePath: null,
  workspaceStatus: "idle",
  sessions: [],
  activeSessionId: null,
  messages: [],
  activity: [],
  context: null,
  pendingPermission: null,
  settingsOpen: false,
  sending: false,
  activeRunId: null,
  serverEpoch: 0,
  error: null,
  notification: null,
  providerConfig: { provider: "anthropic", model: "claude-sonnet-5", baseUrl: "" },
  availableTools: [],
  disabledTools: new Set(),
  defaultMode: "agent",
  defaultPermissionMode: "default",
  agentSettings: {}
};

function hasLoadedWorkspace(state: AppState): boolean {
  return state.workspacePath !== null;
}

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "WORKSPACE_SELECTION_STARTED":
      if (state.sending) return state;
      return { ...state, workspaceStatus: "selecting", error: null };
    case "WORKSPACE_SELECTION_CANCELLED":
      return {
        ...state,
        workspaceStatus: hasLoadedWorkspace(state) ? "ready" : "idle"
      };
    case "WORKSPACE_PREPARING":
      if (state.sending) return state;
      return { ...state, workspaceStatus: "preparing", error: null };
    case "WORKSPACE_READY":
      if (state.sending) return state;
      return {
        ...state,
        workspacePath: action.ready.workspacePath,
        workspaceStatus: "ready",
        sessions: action.ready.sessions,
        activeSessionId: action.ready.activeSessionId,
        messages: action.ready.messages,
        availableTools: action.ready.tools,
        agentSettings: action.ready.agentSettings,
        activity: [],
        context: null,
        pendingPermission: null,
        error: null
      };
    case "WORKSPACE_PREPARATION_FAILED":
      return {
        ...state,
        workspaceStatus: hasLoadedWorkspace(state) ? "ready" : "idle",
        error: action.error
      };
    case "SESSIONS_SET":
      if (
        state.sending ||
        state.workspaceStatus !== "ready" ||
        action.workspacePath !== state.workspacePath
      )
        return state;
      return { ...state, sessions: action.sessions };
    case "SESSION_ACTIVATED":
      if (
        state.sending ||
        state.workspaceStatus !== "ready" ||
        action.workspacePath !== state.workspacePath
      )
        return state;
      return {
        ...state,
        activeSessionId: action.sessionId,
        messages: action.messages,
        activity: [],
        context: null
      };
    case "MESSAGES_SET":
      if (action.sessionId !== state.activeSessionId) return state;
      // El refetch autoritativo ya trae assistant/tool intercalados
      // (agent-loop.ts los persiste en orden); el registro en vivo que lo
      // precedió queda redundante y se descarta para no duplicar el hilo.
      return { ...state, messages: action.messages, activity: [] };
    case "SENDING_STARTED":
      if (state.activeRunId) return state;
      return { ...state, sending: true, activeRunId: action.runId, activity: [] };
    case "SENDING_FINISHED":
      if (state.activeRunId !== action.runId) return state;
      return { ...state, sending: false, activeRunId: null };
    case "SERVER_PROCESS_FAILED":
      return {
        ...state,
        workspacePath: null,
        workspaceStatus: "idle",
        sessions: [],
        activeSessionId: null,
        messages: [],
        activity: [],
        context: null,
        pendingPermission: null,
        sending: false,
        activeRunId: null,
        serverEpoch: state.serverEpoch + 1,
        providerConfig: initialState.providerConfig,
        agentSettings: initialState.agentSettings,
        availableTools: [],
        disabledTools: new Set(),
        error: action.error
      };
    case "SETTINGS_TOGGLE":
      return { ...state, settingsOpen: !state.settingsOpen };
    case "ERROR_SET":
      return { ...state, error: action.error };
    case "ERROR_CLEAR":
      return { ...state, error: null };
    case "NOTIFICATION_SET":
      return { ...state, notification: action.notification };
    case "NOTIFICATION_CLEAR":
      return state.notification?.id === action.id ? { ...state, notification: null } : state;
    case "PERMISSION_RESOLVED":
      return { ...state, pendingPermission: null };
    case "PROVIDER_CONFIG_COMMITTED":
      return { ...state, providerConfig: action.config };
    case "AGENT_SETTINGS_COMMITTED":
      return { ...state, agentSettings: action.settings };
    case "TOOLS_SET":
      return { ...state, availableTools: action.tools };
    case "TOOL_TOGGLED": {
      const disabledTools = new Set(state.disabledTools);
      if (disabledTools.has(action.tool)) disabledTools.delete(action.tool);
      else disabledTools.add(action.tool);
      return { ...state, disabledTools };
    }
    case "DEFAULTS_SET":
      return {
        ...state,
        defaultMode: action.mode ?? state.defaultMode,
        defaultPermissionMode: action.permissionMode ?? state.defaultPermissionMode
      };
    case "SERVER_EVENT": {
      const { event } = action;
      if (event.sessionId !== state.activeSessionId) return state;
      switch (event.type) {
        case "agent:message_delta": {
          const last = state.activity.at(-1);
          if (last?.kind === "assistant_delta" && last.messageId === event.messageId) {
            return {
              ...state,
              activity: [
                ...state.activity.slice(0, -1),
                { ...last, content: last.content + event.delta }
              ]
            };
          }
          return {
            ...state,
            activity: [
              ...state.activity,
              { kind: "assistant_delta", messageId: event.messageId, content: event.delta }
            ]
          };
        }
        case "agent:tool_call":
          return {
            ...state,
            activity: [...state.activity, { kind: "tool_call", toolCall: event.toolCall }]
          };
        case "agent:context_update":
          return { ...state, context: event };
        case "agent:permission_request":
          return { ...state, pendingPermission: event };
      }
    }
  }
}

interface AppContextValue {
  state: AppState;
  dispatch: React.Dispatch<Action>;
}

const AppContext = createContext<AppContextValue | undefined>(undefined);

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);

  useEffect(() => onServerEvent((event) => dispatch({ type: "SERVER_EVENT", event })), []);
  useEffect(
    () =>
      onServerLifecycle((event) => {
        if (event.type === "process:stopped") {
          dispatch({ type: "SERVER_PROCESS_FAILED", error: event.message });
        } else if (event.type === "protocol:error") {
          dispatch({ type: "ERROR_SET", error: event.message });
        }
      }),
    []
  );

  const value = useMemo(() => ({ state, dispatch }), [state]);
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useAppState(): AppContextValue {
  const context = useContext(AppContext);
  if (!context) throw new Error("useAppState debe usarse dentro de <AppStateProvider>.");
  return context;
}
