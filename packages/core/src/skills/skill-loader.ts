import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { SkillMetadata } from "@agentev4/shared";
import { SkillMetadataSchema } from "@agentev4/shared";

export interface SkillIndexEntry extends SkillMetadata {
  /** Ruta absoluta a SKILL.md; el cuerpo se lee solo al activar la skill. */
  path: string;
}

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

function parseFrontmatter(raw: string): { metadata: Record<string, string>; body: string } {
  const match = FRONTMATTER.exec(raw);
  if (!match) return { metadata: {}, body: raw };
  const [, frontmatter, body] = match;
  const metadata: Record<string, string> = {};
  for (const line of frontmatter!.split(/\r?\n/)) {
    const field = /^(\w+):\s*(.*)$/.exec(line);
    if (field) metadata[field[1]!] = field[2]!.trim().replace(/^["']|["']$/g, "");
  }
  return { metadata, body: body!.trim() };
}

/**
 * Escanea `.agente/skills/<nombre>/SKILL.md` al inicio, indexando solo
 * `name`+`description` de cada skill (Fase 9). El cuerpo completo nunca se
 * lee en esta pasada -- eso lo hace `loadSkillBody`, y solo cuando el agente
 * activa la skill explícitamente.
 */
export async function scanSkills(workspacePath: string): Promise<SkillIndexEntry[]> {
  const skillsDir = join(workspacePath, ".agente", "skills");

  let dirNames: string[];
  try {
    const dirents = await readdir(skillsDir, { withFileTypes: true });
    dirNames = dirents.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }

  const entries: SkillIndexEntry[] = [];
  for (const name of dirNames) {
    const path = join(skillsDir, name, "SKILL.md");
    let raw: string;
    try {
      raw = await readFile(path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    const parsed = SkillMetadataSchema.safeParse(parseFrontmatter(raw).metadata);
    if (parsed.success) entries.push({ ...parsed.data, path });
  }
  return entries;
}

/** Carga el cuerpo completo de una skill -- solo se llama tras la activación explícita. */
export async function loadSkillBody(entry: SkillIndexEntry): Promise<string> {
  const raw = await readFile(entry.path, "utf8");
  return parseFrontmatter(raw).body;
}

/** Índice ligero (name+description) apto para inyectar en el prompt inicial. */
export function formatSkillIndex(entries: SkillIndexEntry[]): string {
  return entries.map((entry) => `- ${entry.name}: ${entry.description}`).join("\n");
}
