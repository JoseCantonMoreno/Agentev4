import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { ToolDeclaration } from "@agentev4/shared";
import { toMastraTools } from "./mastra-agent.js";

describe("toMastraTools", () => {
  it("sin declarations produce un mapa de tools vacío", () => {
    expect(toMastraTools([])).toEqual({});
  });

  it("convierte cada ToolDeclaration a una Tool de Mastra sin execute", () => {
    const declarations: ToolDeclaration[] = [
      { name: "FileSystemRead", description: "Lee un archivo.", inputSchema: z.object({ path: z.string() }) }
    ];

    const tools = toMastraTools(declarations);

    expect(Object.keys(tools)).toEqual(["FileSystemRead"]);
    expect(tools.FileSystemRead!.id).toBe("FileSystemRead");
    expect(tools.FileSystemRead!.description).toBe("Lee un archivo.");
    // ponytail: sin `execute` a propósito -- la ejecución real la controla el
    // orquestador externo (agent-loop.ts), nunca Mastra. Ver comentario en
    // mastra-agent.ts.
    expect(tools.FileSystemRead!.execute).toBeUndefined();
  });

  it("preserva el orden y soporta varias tools distintas", () => {
    const declarations: ToolDeclaration[] = [
      { name: "GitStatus", description: "Estado del repo.", inputSchema: z.object({}) },
      { name: "GitCommit", description: "Crea un commit.", inputSchema: z.object({ message: z.string() }) }
    ];

    const tools = toMastraTools(declarations);

    expect(Object.keys(tools)).toEqual(["GitStatus", "GitCommit"]);
  });
});
