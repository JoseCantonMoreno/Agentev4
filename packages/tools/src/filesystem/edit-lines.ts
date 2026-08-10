import { readFile, writeFile } from "node:fs/promises";
import { z } from "zod";
import { defineTool } from "../registry.js";
import { resolveInWorkspace } from "./path-guard.js";

export class LineRangeOutOfBoundsError extends Error {
  constructor(startLine: number, endLine: number, totalLines: number) {
    super(`Rango de líneas [${startLine}, ${endLine}] fuera de límites: el archivo tiene ${totalLines} líneas.`);
    this.name = "LineRangeOutOfBoundsError";
  }
}

export class InvalidLineRangeError extends Error {
  constructor(startLine: number, endLine: number) {
    super(`startLine (${startLine}) no puede ser mayor que endLine (${endLine}).`);
    this.name = "InvalidLineRangeError";
  }
}

const EditLinesInput = z.object({
  workspacePath: z.string(),
  path: z.string(),
  /** 1-indexado, inclusive. */
  startLine: z.number().int().positive(),
  /** 1-indexado, inclusive. */
  endLine: z.number().int().positive(),
  newContent: z.string()
});
const EditLinesOutput = z.object({ path: z.string(), linesReplaced: z.number() });

/**
 * Reemplaza el rango [startLine, endLine] (1-indexado, ambos inclusive) por
 * `newContent`. Validación estricta obligatoria: un rango fuera de límites
 * silenciosamente truncado por `Array.slice` produciría un edit corrupto sin
 * avisar — aquí se rechaza explícitamente en vez de "hacer lo que se pueda".
 */
export const EditLines = defineTool({
  name: "Edit_Lines",
  description:
    "Reemplaza el rango de líneas [startLine, endLine] (1-indexado, inclusive) de un archivo del workspace por newContent.",
  inputSchema: EditLinesInput,
  outputSchema: EditLinesOutput,
  handler: async ({ workspacePath, path, startLine, endLine, newContent }) => {
    if (startLine > endLine) {
      throw new InvalidLineRangeError(startLine, endLine);
    }

    const abs = resolveInWorkspace(workspacePath, path);
    const original = await readFile(abs, "utf8");
    const lines = original.split("\n");

    if (endLine > lines.length) {
      throw new LineRangeOutOfBoundsError(startLine, endLine, lines.length);
    }

    const before = lines.slice(0, startLine - 1);
    const after = lines.slice(endLine);
    const replacement = newContent.split("\n");
    const updated = [...before, ...replacement, ...after].join("\n");

    await writeFile(abs, updated, "utf8");
    return { path, linesReplaced: endLine - startLine + 1 };
  }
});
