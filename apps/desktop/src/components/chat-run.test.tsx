// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReadyWorkspace } from "../lib/workspace";
import { AppStateProvider, useAppState } from "../state/store";
import { ChatPanel } from "./ChatPanel";

const { callServer, listSessionMessages } = vi.hoisted(() => ({
  callServer: vi.fn(),
  listSessionMessages: vi.fn()
}));

vi.mock("../lib/ipc", () => ({
  callServer,
  onServerEvent: () => () => undefined,
  onServerLifecycle: () => () => undefined
}));
vi.mock("../lib/workspace", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/workspace")>()),
  listSessionMessages
}));

const ready: ReadyWorkspace = {
  workspacePath: "C:\\repo",
  sessions: [
    {
      id: "session-1",
      name: "SesiÃ³n de prueba",
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

function ReadyState() {
  const { dispatch } = useAppState();
  useEffect(() => dispatch({ type: "WORKSPACE_READY", ready }), [dispatch]);
  return null;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("chat run lifecycle", () => {
  it("uses a synchronous guard so double activation starts exactly one prompt", async () => {
    callServer.mockImplementation(() => new Promise(() => undefined));
    const user = userEvent.setup();
    render(
      <AppStateProvider>
        <ReadyState />
        <ChatPanel />
      </AppStateProvider>
    );
    await user.type(screen.getByRole("textbox"), "hola");
    const send = screen.getByRole("button", { name: "Enviar" });

    act(() => {
      send.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      send.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(callServer).toHaveBeenCalledTimes(1);
  });

  it("remains sending beyond thirty seconds while a HITL-capable prompt is unresolved", async () => {
    vi.useFakeTimers();
    callServer.mockImplementation(() => new Promise(() => undefined));
    render(
      <AppStateProvider>
        <ReadyState />
        <ChatPanel />
      </AppStateProvider>
    );
    const prompt = screen.getByRole("textbox");
    fireEvent.change(prompt, { target: { value: "hola" } });
    act(() => screen.getByRole("button", { name: "Enviar" }).click());

    await act(async () => vi.advanceTimersByTimeAsync(31_000));

    expect(screen.getByRole("button", { name: /Enviando/ })).toHaveProperty("disabled", true);
  });
});
