import { createContext, useContext, useEffect, useMemo, useReducer, type ReactNode } from "react";
import type {
  AgentContextUpdateEvent,
  AgentIpcEvent,
  AgentMessage,
  AgentMode,
  AgentPermissionRequestEvent,
  AgentToolCallEvent,
  LlmProviderName,
  PermissionMode,
  SessionConfig
} from "@agentev4/shared";
import { onServerEvent } from "../lib/ipc";
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

export interface AppState {
  workspacePath: string | null;
  workspaceStatus: "idle" | "selecting" | "preparing" | "ready";
  sessions: SessionConfig[];
  activeSessionId: string | null;
  messages: AgentMessage[];
  thoughts: string[];
  toolCalls: AgentToolCallEvent[];
  context: AgentContextUpdateEvent | null;
  pendingPermission: AgentPermissionRequestEvent | null;
  settingsOpen: boolean;
  sending: boolean;
  error: string | null;
  notification: AppNotification | null;
  providerConfig: ProviderConfig;
  availableTools: string[];
  disabledTools: Set<string>;
  defaultMode: AgentMode;
  defaultPermissionMode: PermissionMode;
}

export type Action =
  | WorkspaceLifecycleAction
  | { type: "SESSIONS_SET"; sessions: SessionConfig[] }
  | { type: "SESSION_ACTIVATED"; sessionId: string | null; messages: AgentMessage[] }
  | { type: "MESSAGES_SET"; messages: AgentMessage[] }
  | { type: "SENDING_SET"; sending: boolean }
  | { type: "SETTINGS_TOGGLE" }
  | { type: "ERROR_SET"; error: string | null }
  | { type: "ERROR_CLEAR" }
  | { type: "NOTIFICATION_SET"; notification: AppNotification }
  | { type: "NOTIFICATION_CLEAR" }
  | { type: "SERVER_EVENT"; event: AgentIpcEvent }
  | { type: "PERMISSION_RESOLVED" }
  | { type: "PROVIDER_CONFIG_SET"; config: Partial<ProviderConfig> }
  | { type: "TOOLS_SET"; tools: string[] }
  | { type: "TOOL_TOGGLED"; tool: string }
  | { type: "DEFAULTS_SET"; mode?: AgentMode; permissionMode?: PermissionMode };

export const initialState: AppState = {
  workspacePath: null,
  workspaceStatus: "idle",
  sessions: [],
  activeSessionId: null,
  messages: [],
  thoughts: [],
  toolCalls: [],
  context: null,
  pendingPermission: null,
  settingsOpen: false,
  sending: false,
  error: null,
  notification: null,
  providerConfig: { provider: "anthropic", model: "claude-sonnet-5", baseUrl: "" },
  availableTools: [],
  disabledTools: new Set(),
  defaultMode: "agent",
  defaultPermissionMode: "default"
};

function hasReadyWorkspace(state: AppState): boolean {
  return state.workspacePath !== null && state.activeSessionId !== null;
}

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "WORKSPACE_SELECTION_STARTED":
      return { ...state, workspaceStatus: "selecting", error: null };
    case "WORKSPACE_SELECTION_CANCELLED":
      return {
        ...state,
        workspaceStatus: hasReadyWorkspace(state) ? "ready" : "idle"
      };
    case "WORKSPACE_PREPARING":
      return { ...state, workspaceStatus: "preparing", error: null };
    case "WORKSPACE_READY":
      return {
        ...state,
        workspacePath: action.ready.workspacePath,
        workspaceStatus: "ready",
        sessions: action.ready.sessions,
        activeSessionId: action.ready.activeSessionId,
        messages: action.ready.messages,
        availableTools: action.ready.tools,
        thoughts: [],
        toolCalls: [],
        context: null,
        pendingPermission: null,
        error: null
      };
    case "WORKSPACE_PREPARATION_FAILED":
      return {
        ...state,
        workspaceStatus: hasReadyWorkspace(state) ? "ready" : "idle",
        error: action.error
      };
    case "SESSIONS_SET":
      return { ...state, sessions: action.sessions };
    case "SESSION_ACTIVATED":
      return {
        ...state,
        activeSessionId: action.sessionId,
        messages: action.messages,
        thoughts: [],
        toolCalls: [],
        context: null
      };
    case "MESSAGES_SET":
      return { ...state, messages: action.messages };
    case "SENDING_SET":
      return { ...state, sending: action.sending };
    case "SETTINGS_TOGGLE":
      return { ...state, settingsOpen: !state.settingsOpen };
    case "ERROR_SET":
      return { ...state, error: action.error };
    case "ERROR_CLEAR":
      return { ...state, error: null };
    case "NOTIFICATION_SET":
      return { ...state, notification: action.notification };
    case "NOTIFICATION_CLEAR":
      return { ...state, notification: null };
    case "PERMISSION_RESOLVED":
      return { ...state, pendingPermission: null };
    case "PROVIDER_CONFIG_SET":
      return { ...state, providerConfig: { ...state.providerConfig, ...action.config } };
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
        case "agent:thought":
          return { ...state, thoughts: [...state.thoughts, event.content] };
        case "agent:tool_call":
          return { ...state, toolCalls: [...state.toolCalls, event] };
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

  const value = useMemo(() => ({ state, dispatch }), [state]);
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useAppState(): AppContextValue {
  const context = useContext(AppContext);
  if (!context) throw new Error("useAppState debe usarse dentro de <AppStateProvider>.");
  return context;
}
