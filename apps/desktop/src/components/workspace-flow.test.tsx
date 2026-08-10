// @vitest-environment jsdom

import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatPanel } from "./ChatPanel";
import { GlobalFeedback } from "./GlobalFeedback";
import { WorkspaceSelector } from "./WorkspaceSelector";
import { AppStateProvider, useAppState } from "../state/store";
import type { ReadyWorkspace } from "../lib/workspace";

const { selectWorkspaceFolder, prepareWorkspace } = vi.hoisted(() => ({
  selectWorkspaceFolder: vi.fn<() => Promise<string | null>>(),
  prepareWorkspace: vi.fn<() => Promise<ReadyWorkspace>>()
}));

vi.mock("../lib/dialog", () => ({ selectWorkspaceFolder }));

vi.mock("../lib/workspace", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/workspace")>();
  return {
    ...actual,
    createWorkspaceSelectionController: (input: Parameters<typeof actual.createWorkspaceSelectionController>[0]) =>
      actual.createWorkspaceSelectionController({ ...input, prepare: prepareWorkspace })
  };
});

function readyWorkspaceFixture(): ReadyWorkspace {
  return {
    workspacePath: "C:\\repo",
    sessions: [
      {
        id: "session-1",
        name: "Sesión de prueba",
        workspacePath: "C:\\repo",
        mode: "agent",
        permissionMode: "default",
        status: "active",
        tokensUsed: 0,
        createdAt: new Date("2026-08-10T10:00:00.000Z"),
        updatedAt: new Date("2026-08-10T10:00:00.000Z")
      }
    ],
    activeSessionId: "session-1",
    messages: [],
    tools: []
  };
}

function StateSetup({ ready, status, withoutSession, error, notification }: {
  ready?: ReadyWorkspace;
  status?: "selecting" | "preparing";
  withoutSession?: boolean;
  error?: string;
  notification?: string;
}) {
  const { dispatch } = useAppState();

  useEffect(() => {
    if (status === "selecting") dispatch({ type: "WORKSPACE_SELECTION_STARTED" });
    if (status === "preparing") dispatch({ type: "WORKSPACE_PREPARING" });
    if (ready) dispatch({ type: "WORKSPACE_READY", ready });
    if (withoutSession) dispatch({ type: "SESSION_ACTIVATED", sessionId: null, messages: [] });
    if (error) dispatch({ type: "ERROR_SET", error });
    if (notification) dispatch({ type: "NOTIFICATION_SET", notification: { id: "saved", kind: "success", message: notification } });
  }, [dispatch, error, notification, ready, status, withoutSession]);

  return null;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("workspace-to-chat flow", () => {
  it("explains that a workspace must be selected before chat is available", () => {
    render(
      <AppStateProvider>
        <ChatPanel />
      </AppStateProvider>
    );

    expect(screen.getByText("Selecciona una carpeta para preparar el agente.")).not.toBeNull();
  });

  it("shows selecting and preparing states while a workspace is opening", () => {
    const { rerender } = render(
      <AppStateProvider>
        <StateSetup status="selecting" />
        <ChatPanel />
      </AppStateProvider>
    );
    expect(screen.getByText("Seleccionando carpeta…")).not.toBeNull();

    rerender(
      <AppStateProvider>
        <StateSetup status="preparing" />
        <ChatPanel />
      </AppStateProvider>
    );
    expect(screen.getByText("Preparando workspace y sesión…")).not.toBeNull();
  });

  it("shows the chat after selecting a workspace", async () => {
    selectWorkspaceFolder.mockResolvedValue("C:\\repo");
    prepareWorkspace.mockResolvedValue(readyWorkspaceFixture());
    const user = userEvent.setup();
    render(
      <AppStateProvider>
        <WorkspaceSelector />
        <ChatPanel />
        <GlobalFeedback />
      </AppStateProvider>
    );

    await user.click(screen.getByRole("button", { name: /seleccionar carpeta/i }));

    const prompt = await screen.findByPlaceholderText("Escribe un prompt…");
    expect(prompt).toBe(document.activeElement);
    expect(screen.getByText("C:\\repo")).not.toBeNull();
  });

  it("explains that a ready workspace without a session cannot chat yet", () => {
    render(
      <AppStateProvider>
        <StateSetup ready={readyWorkspaceFixture()} withoutSession />
        <ChatPanel />
      </AppStateProvider>
    );

    expect(screen.getByText("Selecciona o crea una sesión para empezar.")).not.toBeNull();
  });

  it("shows initialization errors even when no session exists", async () => {
    selectWorkspaceFolder.mockResolvedValue("C:\\broken");
    prepareWorkspace.mockRejectedValue(new Error("No se pudo iniciar el sidecar"));
    const user = userEvent.setup();
    render(
      <AppStateProvider>
        <WorkspaceSelector />
        <ChatPanel />
        <GlobalFeedback />
      </AppStateProvider>
    );

    await user.click(screen.getByRole("button", { name: /seleccionar carpeta/i }));

    expect((await screen.findByRole("alert")).textContent).toContain("No se pudo iniciar el sidecar");
  });

  it("dismisses successful feedback after three seconds", async () => {
    vi.useFakeTimers();
    render(
      <AppStateProvider>
        <StateSetup notification="Preferencias guardadas" />
        <GlobalFeedback />
      </AppStateProvider>
    );

    expect(screen.getByRole("status")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Cerrar notificación" })).not.toBeNull();
    act(() => vi.advanceTimersByTime(3_000));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("keeps errors visible until the user closes them", async () => {
    const user = userEvent.setup();
    render(
      <AppStateProvider>
        <StateSetup error="No se pudo iniciar el sidecar" />
        <GlobalFeedback />
      </AppStateProvider>
    );

    expect(await screen.findByRole("alert")).not.toBeNull();
    await user.click(screen.getByRole("button", { name: "Cerrar error" }));
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
