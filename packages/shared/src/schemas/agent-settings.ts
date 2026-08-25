import { z } from "zod";

/**
 * Ajustes del agente persistidos en `.agente/settings.json` dentro del
 * workspace (nunca claves de proveedor -- esas siguen solo en `KeyStore`,
 * ver `.agente/rules.md`). Un `systemPromptOverride` ausente o en blanco
 * significa "usa el prompt por defecto"; se normaliza al guardar y al leer
 * para que un textarea vaciado en la UI vuelva limpiamente al default.
 */
export const AgentSettingsSchema = z.object({
  systemPromptOverride: z.string().optional()
});
export type AgentSettings = z.infer<typeof AgentSettingsSchema>;
