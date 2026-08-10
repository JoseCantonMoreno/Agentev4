import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EditLines, InvalidLineRangeError, LineRangeOutOfBoundsError } from "./edit-lines.js";

describe("Edit_Lines", () => {
  let workspacePath: string;
  let filePath: string;

  beforeEach(async () => {
    workspacePath = await mkdtemp(join(tmpdir(), "agentev4-edit-"));
    filePath = join(workspacePath, "file.txt");
    await writeFile(filePath, ["line1", "line2", "line3", "line4", "line5"].join("\n"), "utf8");
  });

  afterEach(async () => {
    await rm(workspacePath, { recursive: true, force: true });
  });

  it("reemplaza un rango intermedio por una única línea", async () => {
    const result = await EditLines.handler({
      workspacePath,
      path: "file.txt",
      startLine: 2,
      endLine: 3,
      newContent: "reemplazo"
    });

    expect(result).toEqual({ path: "file.txt", linesReplaced: 2 });
    await expect(readFile(filePath, "utf8")).resolves.toBe("line1\nreemplazo\nline4\nline5");
  });

  it("reemplaza la primera línea (startLine=1) sin desplazar el índice", async () => {
    await EditLines.handler({ workspacePath, path: "file.txt", startLine: 1, endLine: 1, newContent: "nueva1" });
    await expect(readFile(filePath, "utf8")).resolves.toBe("nueva1\nline2\nline3\nline4\nline5");
  });

  it("reemplaza la última línea (endLine=totalLines) sin fallar por off-by-one", async () => {
    await EditLines.handler({ workspacePath, path: "file.txt", startLine: 5, endLine: 5, newContent: "nueva5" });
    await expect(readFile(filePath, "utf8")).resolves.toBe("line1\nline2\nline3\nline4\nnueva5");
  });

  it("permite expandir el rango a varias líneas nuevas", async () => {
    await EditLines.handler({
      workspacePath,
      path: "file.txt",
      startLine: 3,
      endLine: 3,
      newContent: "a\nb\nc"
    });
    await expect(readFile(filePath, "utf8")).resolves.toBe("line1\nline2\na\nb\nc\nline4\nline5");
  });

  it("rechaza endLine por encima del total de líneas del archivo", async () => {
    await expect(
      EditLines.handler({ workspacePath, path: "file.txt", startLine: 1, endLine: 6, newContent: "x" })
    ).rejects.toThrow(LineRangeOutOfBoundsError);
  });

  it("rechaza startLine mayor que endLine", async () => {
    await expect(
      EditLines.handler({ workspacePath, path: "file.txt", startLine: 4, endLine: 2, newContent: "x" })
    ).rejects.toThrow(InvalidLineRangeError);
  });

  it("startLine=0 es rechazado por el esquema Zod (1-indexado)", () => {
    const parsed = EditLines.inputSchema.safeParse({
      workspacePath,
      path: "file.txt",
      startLine: 0,
      endLine: 1,
      newContent: "x"
    });
    expect(parsed.success).toBe(false);
  });
});
