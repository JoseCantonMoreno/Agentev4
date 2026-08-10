import { describe, expect, it } from "vitest";
import type { AgentMessage } from "@agentev4/shared";
import { maybeCompact } from "./compaction.js";

function msg(role: AgentMessage["role"], content: string, id: string): AgentMessage {
  return { id, role, content, createdAt: new Date() };
}

/** Fixture de historial largo (Fase 7 DoD): objetivos, archivos editados y una decisión, seguidos de relleno. */
function longHistoryFixture(): AgentMessage[] {
  const messages: AgentMessage[] = [
    msg("user", "Quiero implementar autenticación con JWT en el backend.", "u1"),
    msg("assistant", "Voy a editar src/auth/login.ts para añadir el middleware.", "a1"),
    msg("tool", "Archivo actualizado: src/auth/login.ts", "t1"),
    msg("assistant", "Decidimos usar bcrypt en vez de argon2 por simplicidad de despliegue.", "a2"),
    msg("user", "También necesito que valides el formulario en el frontend.", "u2"),
    msg("assistant", "Actualicé src/components/LoginForm.tsx con la validación.", "a3")
  ];
  for (let i = 0; i < 40; i += 1) {
    messages.push(
      msg("assistant", `Relleno de conversación número ${i} para superar el umbral de tokens.`, `filler-${i}`)
    );
  }
  return messages;
}

describe("maybeCompact", () => {
  it("no compacta si el uso de tokens está por debajo del umbral", () => {
    const messages = [msg("user", "hola", "u1")];
    const result = maybeCompact({ systemPrompt: "sistema", rules: "reglas", tools: "", messages, maxTokens: 100000 });
    expect(result.compacted).toBe(false);
    expect(result.messages).toEqual(messages);
  });

  it("no compacta si ya no quedan mensajes antiguos que resumir", () => {
    const messages = [msg("user", "hola", "u1"), msg("assistant", "hey", "a1")];
    const result = maybeCompact({ systemPrompt: "", rules: "", tools: "", messages, maxTokens: 1, keepRecent: 10 });
    expect(result.compacted).toBe(false);
  });

  it("compacta al cruzar el umbral, preservando objetivos, archivos y decisiones clave", () => {
    const messages = longHistoryFixture();
    const result = maybeCompact({
      systemPrompt: "Eres un agente de codificación.",
      rules: "Sigue las reglas del proyecto.",
      tools: "FileSystem_Read, FileSystem_Write",
      messages,
      maxTokens: 200,
      keepRecent: 3
    });

    expect(result.compacted).toBe(true);
    expect(result.boundary).toBeDefined();
    expect(result.boundary?.preservedGoals).toEqual([
      "Quiero implementar autenticación con JWT en el backend.",
      "También necesito que valides el formulario en el frontend."
    ]);
    expect(result.boundary?.preservedFiles).toEqual(
      expect.arrayContaining(["src/auth/login.ts", "src/components/LoginForm.tsx"])
    );
    expect(result.boundary?.preservedDecisions.some((decision) => decision.includes("bcrypt"))).toBe(true);

    expect(result.messages).toHaveLength(1 + 3);
    expect(result.messages[0]?.role).toBe("system");
    expect(result.messages[0]?.content).toContain("Objetivos activos");
    expect(result.messages[0]?.content).toContain("Archivos editados");
    expect(result.messages[0]?.content).toContain("Decisiones clave");
    expect(result.messages.at(-1)?.id).toBe(messages.at(-1)?.id);

    // el desglose recalculado tras compactar baja respecto al original
    expect(result.breakdown.total).toBeLessThan(
      messages.reduce((sum, message) => sum + Math.ceil(message.content.length / 4), 0)
    );
  });
});
