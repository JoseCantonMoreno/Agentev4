// Fase 11: shell básico de Tauri. Toda la lógica del agente (SessionManager,
// PermissionEngine, AgentInterface...) vive en el sidecar Node
// (`apps/desktop/server`, packages/core/tools de Fases 1-10); este proceso
// Rust solo aporta la ventana nativa y los plugins de diálogo/shell que el
// frontend invoca directamente (sin comandos Tauri custom todavía).
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .run(tauri::generate_context!())
        .expect("error al ejecutar la aplicación Tauri");
}
