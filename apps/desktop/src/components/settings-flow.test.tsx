// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { callServer } from "../lib/ipc";
import { AppStateProvider, useAppState } from "../state/store";
import { GlobalFeedback } from "./GlobalFeedback";
import { SettingsPanel } from "./SettingsPanel";

const serverLifecycle = vi.hoisted(() => ({
  listener: undefined as ((event: { type: "process:stopped"; message: string }) => void) | undefined
}));

vi.mock("../lib/ipc", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/ipc")>()),
  callServer: vi.fn(),
  onServerLifecycle: vi.fn(
    (listener: (event: { type: "process:stopped"; message: string }) => void) => {
      serverLifecycle.listener = listener;
      return () => {
        if (serverLifecycle.listener === listener) serverLifecycle.listener = undefined;
      };
    }
  )
}));

function OpenSettings(): React.ReactElement {
  const { dispatch } = useAppState();

  useEffect(() => dispatch({ type: "SETTINGS_TOGGLE" }), [dispatch]);
  return (
    <>
      <SettingsPanel />
      <GlobalFeedback />
    </>
  );
}

function StateInspector(): React.ReactElement {
  const { state, dispatch } = useAppState();

  return (
    <>
      <button type="button" onClick={() => dispatch({ type: "SETTINGS_TOGGLE" })}>
        Alternar ajustes
      </button>
      <pre data-testid="state-json">{JSON.stringify(state)}</pre>
    </>
  );
}

function SettingsHarness(): React.ReactElement {
  return (
    <AppStateProvider>
      <StateInspector />
      <OpenSettings />
    </AppStateProvider>
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  serverLifecycle.listener = undefined;
});

describe("provider settings save flow", () => {
  it("resets an open panel on crash, ignores stale key state, and retries with the local key", async () => {
    const pendingHasKey: Array<{
      provider: string;
      resolve: (value: { hasKey: boolean }) => void;
    }> = [];
    let initialAnthropicRead = true;
    let saveCount = 0;
    vi.mocked(callServer).mockImplementation((method, params) => {
      if (method === "hasApiKey") {
        const provider = params?.provider as string;
        if (provider === "anthropic" && initialAnthropicRead) {
          initialAnthropicRead = false;
          return Promise.resolve({ hasKey: false });
        }
        return new Promise<{ hasKey: boolean }>((resolve) => {
          pendingHasKey.push({ provider, resolve });
        });
      }
      if (method === "saveProviderSettings" && saveCount++ === 0) {
        return Promise.resolve({
          config: { provider: "openai", model: "gpt-5" },
          hasApiKey: true
        });
      }
      if (method === "saveProviderSettings") {
        return Promise.resolve({
          config: { provider: "openai", model: "gpt-5" },
          hasApiKey: true
        });
      }
      throw new Error(`Unexpected method: ${method}`);
    });
    const user = userEvent.setup();
    const retrySecret = "sk-local-retry-after-crash";

    render(<SettingsHarness />);
    await user.selectOptions(screen.getByLabelText("Proveedor"), "openai");
    await user.clear(screen.getByLabelText("Modelo"));
    await user.type(screen.getByLabelText("Modelo"), "gpt-5");
    await user.type(screen.getByLabelText("API key"), "sk-first-process");
    await user.click(screen.getByRole("button", { name: "Guardar configuraci\u00f3n" }));
    await waitFor(() => {
      expect((screen.getByLabelText("API key") as HTMLInputElement).placeholder).toContain(
        "Clave configurada"
      );
    });
    await user.type(screen.getByLabelText("API key"), retrySecret);

    act(() => {
      serverLifecycle.listener?.({
        type: "process:stopped",
        message: "El servidor del agente se cerr\u00f3"
      });
    });

    await waitFor(() => {
      expect((screen.getByLabelText("Proveedor") as HTMLSelectElement).value).toBe("anthropic");
      expect((screen.getByLabelText("Modelo") as HTMLInputElement).value).toBe("claude-sonnet-5");
      expect((screen.getByLabelText("API key") as HTMLInputElement).placeholder).toBe("API key");
      expect((screen.getByLabelText("API key") as HTMLInputElement).value).toBe("");
    });
    expect(screen.getByTestId("state-json").textContent).toContain('"serverEpoch":1');
    expect(screen.getByTestId("state-json").textContent).not.toContain(retrySecret);
    expect(document.body.innerHTML).not.toContain(retrySecret);

    await waitFor(() =>
      expect(pendingHasKey.some(({ provider }) => provider === "anthropic")).toBe(true)
    );
    act(() => {
      for (const request of pendingHasKey) {
        request.resolve({ hasKey: request.provider === "openai" });
      }
    });
    await waitFor(() => {
      expect((screen.getByLabelText("API key") as HTMLInputElement).placeholder).toBe("API key");
    });

    await user.selectOptions(screen.getByLabelText("Proveedor"), "openai");
    await user.clear(screen.getByLabelText("Modelo"));
    await user.type(screen.getByLabelText("Modelo"), "gpt-5");
    await user.click(screen.getByRole("button", { name: "Guardar configuraci\u00f3n" }));
    expect(
      vi.mocked(callServer).mock.calls.filter(([method]) => method === "saveProviderSettings")[1]
    ).toEqual([
      "saveProviderSettings",
      {
        provider: "openai",
        model: "gpt-5",
        baseUrl: "",
        apiKey: retrySecret
      }
    ]);
    await waitFor(() =>
      expect((screen.getByLabelText("API key") as HTMLInputElement).value).toBe("")
    );
  });

  it("commits provider settings and shows success only after the server confirms", async () => {
    let confirmSave: (settings: {
      config: { provider: "openai"; model: string };
      hasApiKey: boolean;
    }) => void;
    vi.mocked(callServer).mockImplementation(async (method) => {
      if (method === "hasApiKey") return { hasKey: false };
      if (method === "saveProviderSettings") {
        return new Promise((resolve) => {
          confirmSave = resolve;
        });
      }
      throw new Error(`Unexpected method: ${method}`);
    });
    const user = userEvent.setup();

    render(<SettingsHarness />);

    await user.selectOptions(screen.getByLabelText("Proveedor"), "openai");
    await user.clear(screen.getByLabelText("Modelo"));
    await user.type(screen.getByLabelText("Modelo"), "gpt-5");
    await user.type(screen.getByLabelText("API key"), "sk-secret");
    await user.click(screen.getByRole("button", { name: "Guardar configuración" }));

    expect(screen.queryByRole("status")).toBeNull();
    expect((screen.getByRole("button", { name: "Guardando…" }) as HTMLButtonElement).disabled).toBe(
      true
    );
    confirmSave!({ config: { provider: "openai", model: "gpt-5" }, hasApiKey: true });
    expect((await screen.findByRole("status")).textContent).toContain(
      "Configuración guardada correctamente"
    );
    expect((screen.getByLabelText("API key") as HTMLInputElement).value).toBe("");
  });

  it("keeps the draft and allows a retry when saving fails", async () => {
    let saveAttempts = 0;
    vi.mocked(callServer).mockImplementation(async (method) => {
      if (method === "hasApiKey") return { hasKey: false };
      if (method === "saveProviderSettings" && saveAttempts++ === 0) {
        throw new Error("La API key es obligatoria para este proveedor.");
      }
      if (method === "saveProviderSettings") {
        return { config: { provider: "anthropic", model: "model-under-test" }, hasApiKey: true };
      }
      throw new Error(`Unexpected method: ${method}`);
    });
    const user = userEvent.setup();

    render(<SettingsHarness />);

    await user.clear(screen.getByLabelText("Modelo"));
    await user.type(screen.getByLabelText("Modelo"), "model-under-test");
    await user.click(screen.getByRole("button", { name: "Guardar configuración" }));

    expect((await screen.findByRole("alert")).textContent).toContain("La API key es obligatoria");
    expect((screen.getByLabelText("Modelo") as HTMLInputElement).value).toBe("model-under-test");
    expect(screen.queryByText("Configuración guardada correctamente")).toBeNull();

    await user.type(screen.getByLabelText("API key"), "sk-retry-secret");
    await user.click(screen.getByRole("button", { name: "Guardar configuración" }));

    expect((await screen.findByRole("status")).textContent).toContain(
      "Configuración guardada correctamente"
    );
  });

  it("synchronizes a reopened panel with the config confirmed while its save was pending", async () => {
    let confirmSave: (settings: {
      config: { provider: "openai"; model: string };
      hasApiKey: boolean;
    }) => void;
    vi.mocked(callServer).mockImplementation(async (method) => {
      if (method === "hasApiKey") return { hasKey: false };
      if (method === "saveProviderSettings") {
        return new Promise((resolve) => {
          confirmSave = resolve;
        });
      }
      throw new Error(`Unexpected method: ${method}`);
    });
    const user = userEvent.setup();

    render(<SettingsHarness />);
    await user.selectOptions(screen.getByLabelText("Proveedor"), "openai");
    await user.clear(screen.getByLabelText("Modelo"));
    await user.type(screen.getByLabelText("Modelo"), "model-b");
    await user.type(screen.getByLabelText("API key"), "sk-close-reopen-secret");
    await user.click(screen.getByRole("button", { name: "Guardar configuración" }));

    await user.click(screen.getByRole("button", { name: "Alternar ajustes" }));
    expect(screen.queryByLabelText("Modelo")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Alternar ajustes" }));
    expect(((await screen.findByLabelText("Modelo")) as HTMLInputElement).value).toBe(
      "claude-sonnet-5"
    );

    confirmSave!({ config: { provider: "openai", model: "model-b" }, hasApiKey: true });

    await waitFor(() => {
      expect((screen.getByLabelText("Proveedor") as HTMLSelectElement).value).toBe("openai");
      expect((screen.getByLabelText("Modelo") as HTMLInputElement).value).toBe("model-b");
    });
    expect(screen.getByTestId("state-json").textContent).toContain('"provider":"openai"');
    expect(screen.getByTestId("state-json").textContent).toContain('"model":"model-b"');
  });

  it("resets key status on provider change and ignores an out-of-order previous response", async () => {
    const hasKeyResolvers = new Map<string, (value: { hasKey: boolean }) => void>();
    vi.mocked(callServer).mockImplementation((method, params) => {
      if (method === "hasApiKey") {
        const provider = params?.provider as string;
        return new Promise<{ hasKey: boolean }>((resolve) =>
          hasKeyResolvers.set(provider, resolve)
        );
      }
      throw new Error(`Unexpected method: ${method}`);
    });
    const user = userEvent.setup();

    render(<SettingsHarness />);
    await waitFor(() => expect(hasKeyResolvers.has("anthropic")).toBe(true));
    hasKeyResolvers.get("anthropic")!({ hasKey: true });
    await waitFor(() => {
      expect((screen.getByLabelText("API key") as HTMLInputElement).placeholder).toContain(
        "Clave configurada"
      );
    });

    await user.selectOptions(screen.getByLabelText("Proveedor"), "openai");
    expect((screen.getByLabelText("API key") as HTMLInputElement).placeholder).toBe("API key");
    await waitFor(() => expect(hasKeyResolvers.has("openai")).toBe(true));
    await user.selectOptions(screen.getByLabelText("Proveedor"), "gemini");
    await waitFor(() => expect(hasKeyResolvers.has("gemini")).toBe(true));
    hasKeyResolvers.get("gemini")!({ hasKey: false });
    await waitFor(() => {
      expect((screen.getByLabelText("API key") as HTMLInputElement).placeholder).toBe("API key");
    });

    await act(async () => {
      hasKeyResolvers.get("openai")!({ hasKey: true });
      await Promise.resolve();
    });
    expect((screen.getByLabelText("API key") as HTMLInputElement).placeholder).toBe("API key");
  });

  it("starts one save for synchronous double activation and leaves no secret in serializable state or DOM", async () => {
    let confirmSave: (settings: {
      config: { provider: "anthropic"; model: string };
      hasApiKey: boolean;
    }) => void;
    vi.mocked(callServer).mockImplementation(async (method) => {
      if (method === "hasApiKey") return { hasKey: false };
      if (method === "saveProviderSettings") {
        return new Promise((resolve) => {
          confirmSave = resolve;
        });
      }
      throw new Error(`Unexpected method: ${method}`);
    });
    const user = userEvent.setup();

    render(<SettingsHarness />);
    const secret = "sk-double-submit-secret";
    await user.type(screen.getByLabelText("API key"), secret);
    const saveButton = screen.getByRole("button", { name: "Guardar configuración" });
    act(() => {
      saveButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      saveButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(
      vi.mocked(callServer).mock.calls.filter(([method]) => method === "saveProviderSettings")
    ).toHaveLength(1);
    confirmSave!({ config: { provider: "anthropic", model: "claude-sonnet-5" }, hasApiKey: true });
    await screen.findByRole("status");

    expect(screen.getByTestId("state-json").textContent).not.toContain(secret);
    expect(document.body.innerHTML).not.toContain(secret);
    expect((screen.getByLabelText("API key") as HTMLInputElement).value).toBe("");
  });
});
