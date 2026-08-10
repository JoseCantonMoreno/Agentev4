import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { AppDatabase } from "./client.js";
import { memoryChunks } from "./schema.js";

export interface MemoryChunk {
  id: string;
  sessionId: string | undefined;
  content: string;
  createdAt: Date;
}

export interface MemorySearchResult extends MemoryChunk {
  score: number;
}

function cosineSimilarity(a: number[], b: number[]): number {
  const length = Math.min(a.length, b.length);
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < length; i += 1) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    dot += av * bv;
    normA += av * av;
    normB += bv * bv;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * Memoria semántica mínima (RAG) sobre `memory_chunks`. Genera el embedding
 * es responsabilidad de quien llama (no hay proveedor LLM abstraído hasta la
 * Fase 10); esta capa solo almacena vectores ya calculados y los compara.
 *
 * ponytail: `semanticSearch` es un escaneo lineal con similitud coseno en JS
 * (sin índice ANN ni extensión vectorial de SQLite) — correcto para cientos
 * o pocos miles de chunks. Si el corpus crece lo suficiente como para que el
 * escaneo sea el cuello de botella, migrar a `sqlite-vec` o un vector store
 * dedicado.
 */
export class SemanticMemory {
  constructor(private readonly db: AppDatabase) {}

  addChunk(content: string, embedding: number[], sessionId?: string): MemoryChunk {
    const id = randomUUID();
    const createdAt = new Date();
    this.db
      .insert(memoryChunks)
      .values({ id, sessionId: sessionId ?? null, content, embedding: JSON.stringify(embedding), createdAt })
      .run();
    return { id, sessionId, content, createdAt };
  }

  semanticSearch(queryEmbedding: number[], topK: number, sessionId?: string): MemorySearchResult[] {
    const rows =
      sessionId === undefined
        ? this.db.select().from(memoryChunks).all()
        : this.db.select().from(memoryChunks).where(eq(memoryChunks.sessionId, sessionId)).all();

    return rows
      .map((row) => ({
        id: row.id,
        sessionId: row.sessionId ?? undefined,
        content: row.content,
        createdAt: row.createdAt,
        score: cosineSimilarity(queryEmbedding, JSON.parse(row.embedding) as number[])
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }
}

