import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  FileSystemDelete,
  FileSystemMove,
  FileSystemRead,
  FileSystemSearch,
  FileSystemWrite
} from "./filesystem-tools.js";
import { PathEscapesWorkspaceError } from "./path-guard.js";

describe("FileSystem tools", () => {
  let workspacePath: string;

  beforeEach(async () => {
    workspacePath = await mkdtemp(join(tmpdir(), "agentev4-fs-"));
  });

  afterEach(async () => {
    await rm(workspacePath, { recursive: true, force: true });
  });

  it("FileSystem_Write crea el archivo y FileSystem_Read devuelve su contenido envuelto como untrusted", async () => {
    const written = await FileSystemWrite.handler({ workspacePath, path: "notes/a.txt", content: "hola" });
    expect(written).toEqual({ path: "notes/a.txt", bytesWritten: 4 });

    const read = await FileSystemRead.handler({ workspacePath, path: "notes/a.txt" });
    expect(read).toContain('<untrusted_data source="file:notes/a.txt">');
    expect(read).toContain("hola");
  });

  it("FileSystem_Move renombra el archivo", async () => {
    await FileSystemWrite.handler({ workspacePath, path: "a.txt", content: "x" });
    await FileSystemMove.handler({ workspacePath, from: "a.txt", to: "b/a.txt" });

    await expect(readFile(join(workspacePath, "b", "a.txt"), "utf8")).resolves.toBe("x");
  });

  it("FileSystem_Delete elimina el archivo", async () => {
    await FileSystemWrite.handler({ workspacePath, path: "a.txt", content: "x" });
    const result = await FileSystemDelete.handler({ workspacePath, path: "a.txt" });

    expect(result.deleted).toBe(true);
    await expect(readFile(join(workspacePath, "a.txt"), "utf8")).rejects.toThrow();
  });

  it("FileSystem_Search encuentra coincidencias de texto y omite node_modules", async () => {
    await FileSystemWrite.handler({ workspacePath, path: "src/a.ts", content: "const target = 1;" });
    await FileSystemWrite.handler({ workspacePath, path: "node_modules/lib/index.js", content: "target" });

    const result = await FileSystemSearch.handler({ workspacePath, query: "target", path: "." });

    expect(result).toContain("src/a.ts:1");
    expect(result).not.toContain("node_modules");
  });

  it("rechaza rutas que escapan del workspace en las cuatro operaciones", async () => {
    await expect(FileSystemRead.handler({ workspacePath, path: "../fuera.txt" })).rejects.toThrow(
      PathEscapesWorkspaceError
    );
    await expect(FileSystemWrite.handler({ workspacePath, path: "../fuera.txt", content: "x" })).rejects.toThrow(
      PathEscapesWorkspaceError
    );
    await expect(FileSystemDelete.handler({ workspacePath, path: "../fuera.txt" })).rejects.toThrow(
      PathEscapesWorkspaceError
    );
    await expect(
      FileSystemMove.handler({ workspacePath, from: "a.txt", to: "../fuera.txt" })
    ).rejects.toThrow(PathEscapesWorkspaceError);
  });
});
