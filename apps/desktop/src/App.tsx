import { Settings } from "lucide-react";
import { ChatPanel } from "./components/ChatPanel";
import { ContextGauge } from "./components/ContextGauge";
import { PermissionModal } from "./components/PermissionModal";
import { SessionPanel } from "./components/SessionPanel";
import { SettingsPanel } from "./components/SettingsPanel";
import { WorkspaceSelector } from "./components/WorkspaceSelector";
import { AppStateProvider, useAppState } from "./state/store";

function Shell() {
  const { dispatch } = useAppState();

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-neutral-800 px-4 py-2">
        <h1 className="text-sm font-semibold tracking-wide text-neutral-300">Agentev4</h1>
        <div className="flex items-center gap-4">
          <ContextGauge />
          <button
            type="button"
            onClick={() => dispatch({ type: "SETTINGS_TOGGLE" })}
            className="text-neutral-400 hover:text-neutral-100"
            title="Ajustes"
          >
            <Settings size={18} />
          </button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <aside className="flex w-72 flex-col gap-3 border-r border-neutral-800 p-3">
          <WorkspaceSelector />
          <SessionPanel />
        </aside>
        <main className="flex flex-1 flex-col gap-3 p-3">
          <ChatPanel />
        </main>
      </div>

      <SettingsPanel />
      <PermissionModal />
    </div>
  );
}

export default function App() {
  return (
    <AppStateProvider>
      <Shell />
    </AppStateProvider>
  );
}
