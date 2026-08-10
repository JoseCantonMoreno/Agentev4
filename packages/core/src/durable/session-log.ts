import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { DurableLogEntry } from "@agentev4/shared";
import { DurableLogEntrySchema } from "@agentev4/shared";

/**
 * Escribe una entrada del log durable. Pasa siempre por `DurableLogEntrySchema.parse`
 * antes de serializar (Fase 10, DoD de seguridad de claves): Zod descarta
 * cualquier campo fuera del esquema, así que un campo ajeno adjuntado por
 * error (p.ej. una `apiKey`) nunca llega a tocar disco.
 */
export async function appendLogEntry(logPath: string, entry: DurableLogEntry): Promise<void> {
  await mkdir(dirname(logPath), { recursive: true });
  const sanitized = DurableLogEntrySchema.parse(entry);
  await appendFile(logPath, `${JSON.stringify(sanitized)}\n`, "utf8");
}

/** Replay exacto del JSONL: cada línea es una entrada, en el orden en que se escribió. */
export async function replayLog(logPath: string): Promise<DurableLogEntry[]> {
  let content: string;
  try {
    content = await readFile(logPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  return content
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => DurableLogEntrySchema.parse(JSON.parse(line)));
}

export function latestCheckpoint(
  entries: DurableLogEntry[]
): Extract<DurableLogEntry, { type: "checkpoint" }> | undefined {
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i];
    if (entry && entry.type === "checkpoint") return entry;
  }
  return undefined;
}
