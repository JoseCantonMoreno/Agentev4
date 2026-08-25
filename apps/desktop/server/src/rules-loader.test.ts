import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadWorkspaceRules, rulesPath } from "./rules-loader.js";

const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function createWorkspace(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "agentev4-rules-loader-"));
  cleanup.push(directory);
  return directory;
}

describe("loadWorkspaceRules", () => {
  it("returns an empty string when .agente/rules.md doesn't exist", async () => {
    const directory = await createWorkspace();

    await expect(loadWorkspaceRules(directory)).resolves.toBe("");
  });

  it("returns the file content when .agente/rules.md exists", async () => {
    const directory = await createWorkspace();
    await mkdir(join(directory, ".agente"), { recursive: true });
    await writeFile(rulesPath(directory), "# Reglas\n\nUsa TypeScript estricto.", "utf8");

    await expect(loadWorkspaceRules(directory)).resolves.toBe(
      "# Reglas\n\nUsa TypeScript estricto."
    );
  });

  it("propagates errors other than ENOENT", async () => {
    const directory = await createWorkspace();
    // Un directorio en vez de un archivo dispara EISDIR, no ENOENT.
    await mkdir(rulesPath(directory), { recursive: true });

    await expect(loadWorkspaceRules(directory)).rejects.toThrow();
  });
});
