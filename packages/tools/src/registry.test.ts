import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineTool, executeRegisteredTool, type ToolRegistry } from "./registry.js";

const registry: ToolRegistry = {
  Boom: defineTool({
    name: "Boom",
    description: "Tool de prueba que siempre lanza, para verificar la captura de errores.",
    inputSchema: z.object({ n: z.number() }),
    outputSchema: z.string(),
    handler: async () => {
      throw new Error("kaboom");
    }
  }),
  Double: defineTool({
    name: "Double",
    description: "Tool de prueba que duplica un número.",
    inputSchema: z.object({ n: z.number() }),
    outputSchema: z.number(),
    handler: async (input) => input.n * 2
  })
};

describe("executeRegisteredTool", () => {
  it("devuelve isError si la tool no existe en el registro", async () => {
    const result = await executeRegisteredTool(registry, { id: "c1", name: "NoExiste", input: {} });

    expect(result.isError).toBe(true);
    expect(result.output).toContain("NoExiste");
  });

  it("devuelve isError si el input no pasa el schema Zod, sin invocar el handler", async () => {
    const result = await executeRegisteredTool(registry, { id: "c1", name: "Double", input: { n: "no-es-numero" } });

    expect(result.isError).toBe(true);
    expect(result.output).toContain("Input inválido");
  });

  it("captura una excepción del handler como isError en vez de propagarla", async () => {
    const result = await executeRegisteredTool(registry, { id: "c1", name: "Boom", input: { n: 1 } });

    expect(result.isError).toBe(true);
    expect(result.output).toBe("kaboom");
  });

  it("ejecuta el handler y devuelve isError=false con el output real en el camino feliz", async () => {
    const result = await executeRegisteredTool(registry, { id: "c1", name: "Double", input: { n: 21 } });

    expect(result.isError).toBe(false);
    expect(result.output).toBe(42);
  });
});
