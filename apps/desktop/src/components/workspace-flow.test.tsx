// @vitest-environment jsdom

import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatPanel } from "./ChatPanel";
import { GlobalFeedback } from "./GlobalFeedback";
import { SessionPanel } from "./SessionPanel";
import { WorkspaceSelector } from "./WorkspaceSelector";
import { AppStateProvider, initialState, reducer, useAppState } from "../state/store";
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
    createWorkspaceSelectionController: (
      input: Parameters<typeof actual.createWorkspaceSelectionController>[0]
    ) => actual.createWorkspaceSelectionController({ ...input, prepare: prepareWorkspace })
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
    tools: [],
    agentSettings: {}
  };
}

function StateSetup({
  ready,
  status,
  withoutSession,
  error,
  notification,
  followUp,
  sending
}: {
  ready?: ReadyWorkspace;
  status?: "selecting" | "preparing";
  withoutSession?: boolean;
  error?: string;
  notification?: string;
  followUp?: "cancelled" | "failed";
  sending?: boolean;
}) {
  const { dispatch } = useAppState();

  useEffect(() => {
    if (ready) dispatch({ type: "WORKSPACE_READY", ready });
    if (status === "selecting") dispatch({ type: "WORKSPACE_SELECTION_STARTED" });
    if (status === "preparing") dispatch({ type: "WORKSPACE_PREPARING" });
    if (withoutSession)
      dispatch({
        type: "SESSION_ACTIVATED",
        workspacePath: ready?.workspacePath ?? "C:\\repo",
        sessionId: null,
        messages: []
      });
    if (followUp === "cancelled") {
      dispatch({ type: "WORKSPACE_SELECTION_STARTED" });
      dispatch({ type: "WORKSPACE_SELECTION_CANCELLED" });
    }
    if (followUp === "failed") {
      dispatch({ type: "WORKSPACE_PREPARING" });
      dispatch({ type: "WORKSPACE_PREPARATION_FAILED", error: "No se pudo iniciar el sidecar" });
    }
    if (error) dispatch({ type: "ERROR_SET", error });
    if (notification)
      dispatch({
        type: "NOTIFICATION_SET",
        notification: { id: "saved", kind: "success", message: notification }
      });
    if (sending) dispatch({ type: "SENDING_STARTED", runId: "workspace-flow" });
  }, [dispatch, error, followUp, notification, ready, sending, status, withoutSession]);

  return null;
}

function TimedNotificationReplacement() {
  const { dispatch } = useAppState();

  useEffect(() => {
    dispatch({
      type: "NOTIFICATION_SET",
      notification: { id: "first", kind: "success", message: "Primera notificación" }
    });
    const replacement = window.setTimeout(
      () =>
        dispatch({
          type: "NOTIFICATION_SET",
          notification: { id: "second", kind: "success", message: "Notificación de reemplazo" }
        }),
      2_999
    );
    return () => window.clearTimeout(replacement);
  }, [dispatch]);

  return null;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("workspace-to-chat flow", () => {
  it("blocks workspace and session navigation controls while a prompt is active", () => {
    render(
      <AppStateProvider>
        <StateSetup ready={readyWorkspaceFixture()} sending />
        <WorkspaceSelector />
        <SessionPanel />
      </AppStateProvider>
    );

    const controls = [
      screen.getByRole("button", { name: "C:\\repo" }),
      screen.getByPlaceholderText("Nombre de la nueva sesi\u00f3n"),
      screen.getByRole("button", { name: "Nueva" }),
      screen.getByRole("button", { name: /Sesi\u00f3n de prueba/ }),
      screen.getByRole("button", { name: "Renombrar" }),
      screen.getByRole("button", { name: "Eliminar" })
    ];

    for (const control of controls) expect(control).toHaveProperty("disabled", true);
  });

  it.each(["selecting", "preparing"] as const)(
    "blocks every session control while a workspace is %s",
    (status) => {
      render(
        <AppStateProvider>
          <StateSetup ready={readyWorkspaceFixture()} status={status} />
          <WorkspaceSelector />
          <SessionPanel />
        </AppStateProvider>
      );

      const controls = [
        screen.getByPlaceholderText("Nombre de la nueva sesi\u00f3n"),
        screen.getByRole("button", { name: "Nueva" }),
        screen.getByRole("button", { name: /Sesi\u00f3n de prueba/ }),
        screen.getByRole("button", { name: "Renombrar" }),
        screen.getByRole("button", { name: "Eliminar" })
      ];
      for (const control of controls) expect(control).toHaveProperty("disabled", true);
    }
  );

  it("explains that a workspace must be selected before chat is available", () => {
    render(
      <AppStateProvider>
        <ChatPanel />
      </AppStateProvider>
    );

    expect(screen.getByText("Selecciona una carpeta para preparar el agente.")).not.toBeNull();
  });

  it.each([
    ["idle", "Selecciona una carpeta para preparar el agente."],
    ["selecting", "Seleccionando carpeta…"],
    ["preparing", "Preparando workspace y sesión…"],
    ["ready-without-session", "Selecciona o crea una sesión para empezar."]
  ] as const)("announces the %s chat state politely", (chatState, message) => {
    render(
      <AppStateProvider>
        {chatState === "selecting" && <StateSetup status="selecting" />}
        {chatState === "preparing" && <StateSetup status="preparing" />}
        {chatState === "ready-without-session" && (
          <StateSetup ready={readyWorkspaceFixture()} withoutSession />
        )}
        <ChatPanel />
      </AppStateProvider>
    );

    const status = screen.getByRole("status");
    expect(status.getAttribute("aria-live")).toBe("polite");
    expect(status.textContent).toContain(message);
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

  it("exposes the ready chat history as a polite live log", () => {
    render(
      <AppStateProvider>
        <StateSetup ready={readyWorkspaceFixture()} />
        <ChatPanel />
      </AppStateProvider>
    );

    const history = screen.getByRole("log", { name: "Historial del chat" });
    expect(history.getAttribute("aria-live")).toBe("polite");
    expect(history.getAttribute("aria-relevant")).toBe("additions text");
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

  it.each(["cancelled", "failed"] as const)(
    "keeps the session prompt after workspace preparation is %s",
    (followUp) => {
      render(
        <AppStateProvider>
          <StateSetup ready={readyWorkspaceFixture()} withoutSession followUp={followUp} />
          <ChatPanel />
        </AppStateProvider>
      );

      expect(screen.getByText("Selecciona o crea una sesión para empezar.")).not.toBeNull();
    }
  );

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

    expect((await screen.findByRole("alert")).textContent).toContain(
      "No se pudo iniciar el sidecar"
    );
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

  it("keeps a replacement notification visible when the first timeout reaches three seconds", () => {
    vi.useFakeTimers();
    render(
      <AppStateProvider>
        <TimedNotificationReplacement />
        <GlobalFeedback />
      </AppStateProvider>
    );

    expect(screen.getByRole("status").textContent).toContain("Primera notificación");
    act(() => vi.advanceTimersByTime(2_999));
    expect(screen.getByRole("status").textContent).toContain("Notificación de reemplazo");
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByRole("status").textContent).toContain("Notificación de reemplazo");
    act(() => vi.advanceTimersByTime(2_999));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("keeps errors visible for three seconds and until the user closes them", () => {
    vi.useFakeTimers();
    render(
      <AppStateProvider>
        <StateSetup error="No se pudo iniciar el sidecar" />
        <GlobalFeedback />
      </AppStateProvider>
    );

    expect(screen.getByRole("alert")).not.toBeNull();
    act(() => vi.advanceTimersByTime(3_000));
    expect(screen.getByRole("alert")).not.toBeNull();
    act(() => screen.getByRole("button", { name: "Cerrar error" }).click());
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("uses neutral and emerald feedback styling for errors", async () => {
    render(
      <AppStateProvider>
        <StateSetup error="No se pudo iniciar el sidecar" />
        <GlobalFeedback />
      </AppStateProvider>
    );

    const alert = await screen.findByRole("alert");
    expect(alert.className).toContain("bg-neutral-900");
    expect(alert.querySelector(".text-emerald-400")).not.toBeNull();
  });
});

describe("workspace and notification state", () => {
  it.each(["WORKSPACE_SELECTION_CANCELLED", "WORKSPACE_PREPARATION_FAILED"] as const)(
    "keeps a sessionless workspace ready after %s",
    (type) => {
      const sessionlessWorkspace = reducer(
        reducer(initialState, { type: "WORKSPACE_READY", ready: readyWorkspaceFixture() }),
        {
          type: "SESSION_ACTIVATED",
          workspacePath: "C:\\repo",
          sessionId: null,
          messages: []
        }
      );
      const pending = reducer(sessionlessWorkspace, {
        type:
          type === "WORKSPACE_SELECTION_CANCELLED"
            ? "WORKSPACE_SELECTION_STARTED"
            : "WORKSPACE_PREPARING"
      });
      const resolved = reducer(
        pending,
        type === "WORKSPACE_SELECTION_CANCELLED"
          ? { type }
          : { type, error: "No se pudo iniciar el sidecar" }
      );

      expect(resolved.workspaceStatus).toBe("ready");
      expect(resolved.workspacePath).toBe("C:\\repo");
      expect(resolved.activeSessionId).toBeNull();
    }
  );

  it("does not clear a replacement notification when an earlier timeout completes", () => {
    const first = reducer(initialState, {
      type: "NOTIFICATION_SET",
      notification: { id: "first", kind: "success", message: "Primera notificación" }
    });
    const replacement = reducer(first, {
      type: "NOTIFICATION_SET",
      notification: { id: "second", kind: "success", message: "Notificación de reemplazo" }
    });
    const afterFirstTimeout = reducer(replacement, { type: "NOTIFICATION_CLEAR", id: "first" });

    expect(afterFirstTimeout.notification).toEqual({
      id: "second",
      kind: "success",
      message: "Notificación de reemplazo"
    });
  });
});
