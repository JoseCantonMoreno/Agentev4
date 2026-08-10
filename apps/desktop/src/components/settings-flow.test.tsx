// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { callServer } from "../lib/ipc";
import { AppStateProvider, useAppState } from "../state/store";
import { GlobalFeedback } from "./GlobalFeedback";
import { SettingsPanel } from "./SettingsPanel";

vi.mock("../lib/ipc", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/ipc")>()),
  callServer: vi.fn()
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

function SettingsHarness(): React.ReactElement {
  return (
    <AppStateProvider>
      <OpenSettings />
    </AppStateProvider>
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("provider settings save flow", () => {
  it("commits provider settings and shows success only after the server confirms", async () => {
    let confirmSave: (settings: { config: { provider: "openai"; model: string }; hasApiKey: boolean }) => void;
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
    expect((screen.getByRole("button", { name: "Guardando…" }) as HTMLButtonElement).disabled).toBe(true);
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

    expect((await screen.findByRole("status")).textContent).toContain("Configuración guardada correctamente");
  });
});
