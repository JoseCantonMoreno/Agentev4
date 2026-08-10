import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { z } from "zod";
import { defineTool } from "../registry.js";
import { wrapUntrusted } from "../security/untrusted.js";
import { resolveInWorkspace } from "./path-guard.js";

const IGNORED_DIRS = new Set(["node_modules", ".git", "dist", ".turbo"]);

const ReadInput = z.object({ workspacePath: z.string(), path: z.string() });

export const FileSystemRead = defineTool({
  name: "FileSystem_Read",
  description: "Lee el contenido de un archivo de texto dentro del workspace activo.",
  inputSchema: ReadInput,
  outputSchema: z.string(),
  handler: async ({ workspacePath, path }) => {
    const abs = resolveInWorkspace(workspacePath, path);
    const content = await readFile(abs, "utf8");
    return wrapUntrusted(content, `file:${path}`);
  }
});

const WriteInput = z.object({ workspacePath: z.string(), path: z.string(), content: z.string() });
const WriteOutput = z.object({ path: z.string(), bytesWritten: z.number() });

export const FileSystemWrite = defineTool({
  name: "FileSystem_Write",
  description:
    "Escribe (crea o sobrescribe) un archivo de texto dentro del workspace activo, creando directorios intermedios si hace falta.",
  inputSchema: WriteInput,
  outputSchema: WriteOutput,
  handler: async ({ workspacePath, path, content }) => {
    const abs = resolveInWorkspace(workspacePath, path);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, content, "utf8");
    return { path, bytesWritten: Buffer.byteLength(content, "utf8") };
  }
});

const DeleteInput = z.object({ workspacePath: z.string(), path: z.string() });
const DeleteOutput = z.object({ path: z.string(), deleted: z.boolean() });

export const FileSystemDelete = defineTool({
  name: "FileSystem_Delete",
  description: "Elimina un archivo o directorio (recursivo) dentro del workspace activo.",
  inputSchema: DeleteInput,
  outputSchema: DeleteOutput,
  handler: async ({ workspacePath, path }) => {
    const abs = resolveInWorkspace(workspacePath, path);
    await rm(abs, { recursive: true, force: true });
    return { path, deleted: true };
  }
});

const MoveInput = z.object({ workspacePath: z.string(), from: z.string(), to: z.string() });
const MoveOutput = z.object({ from: z.string(), to: z.string() });

export const FileSystemMove = defineTool({
  name: "FileSystem_Move",
  description: "Mueve o renombra un archivo o directorio dentro del workspace activo.",
  inputSchema: MoveInput,
  outputSchema: MoveOutput,
  handler: async ({ workspacePath, from, to }) => {
    const absFrom = resolveInWorkspace(workspacePath, from);
    const absTo = resolveInWorkspace(workspacePath, to);
    await mkdir(dirname(absTo), { recursive: true });
    await rename(absFrom, absTo);
    return { from, to };
  }
});

const SearchInput = z.object({
  workspacePath: z.string(),
  query: z.string().min(1),
  path: z.string().default(".")
});

interface SearchMatch {
  path: string;
  line: number;
  text: string;
}

async function walkAndSearch(dir: string, workspaceAbs: string, query: string, out: SearchMatch[]): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (IGNORED_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkAndSearch(full, workspaceAbs, query, out);
    } else if (entry.isFile()) {
      const content = await readFile(full, "utf8").catch(() => null);
      if (content === null) continue;
      content.split("\n").forEach((text, index) => {
        if (text.includes(query)) {
          // ponytail: normaliza a "/" independientemente del SO — un reporte
          // para el LLM no debería depender de si el host es Windows o POSIX.
          out.push({ path: relative(workspaceAbs, full).replaceAll("\\", "/"), line: index + 1, text: text.trim() });
        }
      });
    }
  }
}

export const FileSystemSearch = defineTool({
  name: "FileSystem_Search",
  description:
    "Busca una cadena de texto en los archivos de un directorio del workspace (recursivo, ignora node_modules/.git/dist).",
  inputSchema: SearchInput,
  outputSchema: z.string(),
  handler: async ({ workspacePath, query, path }) => {
    const workspaceAbs = resolveInWorkspace(workspacePath, ".");
    const root = resolveInWorkspace(workspacePath, path);
    const matches: SearchMatch[] = [];
    await walkAndSearch(root, workspaceAbs, query, matches);

    const report = matches.length > 0 ? matches.map((m) => `${m.path}:${m.line}: ${m.text}`).join("\n") : "(sin coincidencias)";
    return wrapUntrusted(report, `search:${query}`);
  }
});
