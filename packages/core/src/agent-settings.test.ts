import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { agentSettingsPath, loadAgentSettings, saveAgentSettings } from "./agent-settings.js";

const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function createWorkspace(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "agentev4-agent-settings-"));
  cleanup.push(directory);
  return directory;
}

describe("loadAgentSettings", () => {
  it("returns an empty object when .agente/settings.json doesn't exist", async () => {
    const workspacePath = await createWorkspace();

    await expect(loadAgentSettings(workspacePath)).resolves.toEqual({});
  });

  it("rejects a malformed settings.json instead of silently ignoring it", async () => {
    const workspacePath = await createWorkspace();
    await mkdir(join(workspacePath, ".agente"), { recursive: true });
    await writeFile(agentSettingsPath(workspacePath), "not json", "utf8");

    await expect(loadAgentSettings(workspacePath)).rejects.toThrow();
  });
});

describe("saveAgentSettings", () => {
  it("writes a valid settings.json that loadAgentSettings reads back unchanged", async () => {
    const workspacePath = await createWorkspace();

    const saved = await saveAgentSettings(workspacePath, {
      systemPromptOverride: "Responde siempre en español."
    });

    expect(saved).toEqual({ systemPromptOverride: "Responde siempre en español." });
    await expect(loadAgentSettings(workspacePath)).resolves.toEqual({
      systemPromptOverride: "Responde siempre en español."
    });
  });

  it("never writes an apiKey field even if the caller tries to sneak one in", async () => {
    const workspacePath = await createWorkspace();

    const saved = await saveAgentSettings(workspacePath, {
      systemPromptOverride: "ok",
      apiKey: "sk-should-not-be-here"
    });

    expect(saved).not.toHaveProperty("apiKey");
    const raw = await readFile(agentSettingsPath(workspacePath), "utf8");
    expect(raw).not.toContain("sk-should-not-be-here");
  });

  it("rejects input that doesn't match the schema", async () => {
    const workspacePath = await createWorkspace();

    await expect(saveAgentSettings(workspacePath, { systemPromptOverride: 42 })).rejects.toThrow();
  });
});
