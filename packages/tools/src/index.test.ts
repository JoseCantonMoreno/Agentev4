import { describe, expect, it } from "vitest";
import { createStaticToolRegistry } from "./index.js";

describe("createStaticToolRegistry", () => {
  it("registra todas las tools estáticas de Fase 5 por su nombre", () => {
    const registry = createStaticToolRegistry();

    expect(Object.keys(registry).sort()).toEqual(
      [
        "FileSystem_Read",
        "FileSystem_Write",
        "FileSystem_Delete",
        "FileSystem_Move",
        "FileSystem_Search",
        "Edit_Lines",
        "Git_Status",
        "Git_Diff",
        "Git_Commit",
        "Git_Branch",
        "Git_Log",
        "Web_Scrape",
        "Context_Inspector",
        "Session_Checkpoint_Save",
        "Session_Checkpoint_Load"
      ].sort()
    );

    for (const [name, tool] of Object.entries(registry)) {
      expect(tool.name).toBe(name);
      expect(tool.description.length).toBeGreaterThan(0);
    }
  });
});
