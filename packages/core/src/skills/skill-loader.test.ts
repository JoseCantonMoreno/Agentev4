import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { countTokens } from "../context/token-counter.js";
import { formatSkillIndex, loadSkillBody, scanSkills } from "./skill-loader.js";

const SKILLS = [
  { name: "backend-patterns", description: "Patrones de arquitectura backend: repos, servicios, caché." },
  { name: "systematic-debugging", description: "Depuración sistemática: aislar causa raíz antes de parchear." },
  { name: "deep-research", description: "Investigación profunda con seguimiento de citas y comparativas." }
];

function skillFile(name: string, description: string, body: string): string {
  return `---\nname: ${name}\ndescription: ${description}\n---\n${body}\n`;
}

describe("skill-loader", () => {
  let workspacePath: string;
  let skillsDir: string;
  const longBody = "Instrucciones detalladas de la skill.\n".repeat(200);

  beforeEach(async () => {
    workspacePath = await mkdtemp(join(tmpdir(), "agentev4-skills-"));
    skillsDir = join(workspacePath, ".agente", "skills");
    for (const skill of SKILLS) {
      const dir = join(skillsDir, skill.name);
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, "SKILL.md"), skillFile(skill.name, skill.description, longBody), "utf8");
    }
  });

  afterEach(async () => {
    await rm(workspacePath, { recursive: true, force: true });
  });

  it("indexa solo name+description de las 3 skills, sin cargar el cuerpo", async () => {
    const entries = await scanSkills(workspacePath);
    expect(entries).toHaveLength(3);
    expect(entries.map((e) => e.name).sort()).toEqual(SKILLS.map((s) => s.name).sort());

    const indexJson = JSON.stringify(entries);
    expect(indexJson).not.toContain("Instrucciones detalladas");
  });

  it("[] si no existe .agente/skills", async () => {
    const emptyWorkspace = await mkdtemp(join(tmpdir(), "agentev4-skills-empty-"));
    expect(await scanSkills(emptyWorkspace)).toEqual([]);
    await rm(emptyWorkspace, { recursive: true, force: true });
  });

  it("ignora una skill sin frontmatter válido", async () => {
    const dir = join(skillsDir, "sin-metadata");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "SKILL.md"), "solo texto plano, sin frontmatter\n", "utf8");

    const entries = await scanSkills(workspacePath);
    expect(entries.map((e) => e.name)).not.toContain("sin-metadata");
  });

  it("loadSkillBody carga el cuerpo completo solo al activar explícitamente", async () => {
    const entries = await scanSkills(workspacePath);
    const target = entries.find((e) => e.name === "backend-patterns")!;
    const body = await loadSkillBody(target);
    expect(body).toContain("Instrucciones detalladas de la skill.");
  });

  it("el lazy loading reduce los tokens del prompt inicial (medición antes/después)", async () => {
    const entries = await scanSkills(workspacePath);

    const lazyIndex = formatSkillIndex(entries);
    const lazyTokens = countTokens(lazyIndex);

    const bodies = await Promise.all(entries.map((entry) => loadSkillBody(entry)));
    const eagerPrompt = entries.map((entry, i) => `${entry.name}: ${entry.description}\n${bodies[i]}`).join("\n");
    const eagerTokens = countTokens(eagerPrompt);

    expect(lazyTokens).toBeLessThan(eagerTokens);
    expect(eagerTokens - lazyTokens).toBeGreaterThan(1000);
  });
});
