import { open } from "@tauri-apps/plugin-dialog";

/** Selector nativo de carpeta de workspace (Fase 11). `null` si el usuario cancela. */
export async function selectWorkspaceFolder(): Promise<string | null> {
  const selected = await open({ directory: true, multiple: false });
  return typeof selected === "string" ? selected : null;
}
