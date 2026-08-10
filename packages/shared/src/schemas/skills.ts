import { z } from "zod";

/** Metadata indexable de una skill (Fase 9): lo único que se carga al arrancar. */
export const SkillMetadataSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1)
});
export type SkillMetadata = z.infer<typeof SkillMetadataSchema>;
