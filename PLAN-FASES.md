# Plan de Implementación por Fases — Agentev4

> Generado a partir de `prompt.md`. Monorepo TypeScript con pnpm. Cada fase debe
> cerrarse con tests en verde (Vitest) y una revisión de 5 ejes (Corrección,
> Legibilidad, Arquitectura, Seguridad, Rendimiento) antes de pasar a la siguiente,
> siguiendo la regla de iteración rápida ("review early, review often").

## Fase 0 — Bootstrap del Monorepo
**Objetivo:** Esqueleto TypeScript funcional con pnpm workspaces.
**Tareas:**
- `pnpm-workspace.yaml` con `apps/*` y `packages/*`.
- `apps/desktop`, `packages/core`, `packages/tools`, `packages/shared` (carpetas vacías + `package.json` + `tsconfig.json` propios, extendiendo un `tsconfig.base.json` raíz).
- ESLint + Prettier compartidos, `husky`/lint-staged opcional para pre-commit.
- Vitest configurado a nivel raíz (workspace mode).
- Convención de commits (`commitlint` + Conventional Commits) documentada en `COMANDOS-GIT.md` (ya existente, revisar/ampliar).
**Entregables:** `pnpm install` y `pnpm test` corren sin error (aunque sin tests aún, el runner debe arrancar).
**DoD:** Estructura de carpetas coincide 1:1 con la sección "ESTRUCTURA DEL PROYECTO" de `prompt.md`.

## Fase 1 — Capa Compartida (`packages/shared`)
**Objetivo:** Tipos y contratos que todo el resto del monorepo consumirá.
**Tareas:**
- Esquemas Zod + tipos TS para: mensajes del Agentic Loop, `ToolCall`/`ToolResult`, eventos IPC (`agent:thought`, `agent:tool_call`, `agent:context_update`), configuración de sesión, configuración de proveedor LLM.
- Definir el contrato `AgentInterface` / `AgentFactory` (la capa de abstracción exigida por la REGLA DE ORO de `prompt.md`) como interfaces puras, sin importar Mastra/Vercel AI SDK todavía.
**Entregables:** `packages/shared` compila y exporta tipos consumibles por los demás paquetes.
**DoD:** 100% de los tipos usados en fases posteriores están definidos aquí primero (single source of truth).

## Fase 2 — Núcleo del Agentic Loop (`packages/core`)
**Objetivo:** Bucle Context Assembly → LLM Execution → Tool Decision → History Accumulation → Re-evaluation, implementado detrás de `AgentInterface`.
**Tareas:**
- Adaptador concreto usando **Mastra + Vercel AI SDK** (combinación recomendada en la vault) implementando `AgentInterface`.
- Gobernanza: `max_turns`, `max_budget_usd`, `effort_level` (low/medium/high/max), evaluación de `stop_reason` (`tool_use`/`end_turn`/`max_tokens`).
- 3 modos: Asistente, Agente (ReAct completo), Plan (solo lectura).
**Entregables:** Loop ejecutable en un script de prueba (sin UI) que responde a un prompt simple sin herramientas.
**DoD:** Tests unitarios cubren los 3 stop_reasons y el corte por `max_turns`/`max_budget_usd`.
**Riesgo conocido:** verificar `specificationVersion` de `ai`/`@ai-sdk/*` antes de fijar versiones (ver Errores #09).

## Fase 3 — Motor de Permisos de 6 Pasos
**Objetivo:** Pipeline estricto de evaluación por cada tool call.
**Tareas:**
- Implementar en orden: Hooks (Pre-ToolUse) → Reglas Deny → Reglas Ask/HITL → Permission Mode activo → Reglas Allow → Callback HITL (`canUseTool`).
- Modos: `default`, `dontAsk`, `acceptEdits`, `plan`, `bypassPermissions`, `auto`.
- Sintaxis de reglas con scoping (`Bash(rm *)`, `Edit(/secrets/**)`).
**Entregables:** Módulo `PermissionEngine` puro (sin UI), con `canUseTool` como callback inyectable.
**DoD:** Tests unitarios: una tool bloqueada por deny nunca llega a HITL; una tool en allow-list nunca pide confirmación; orden de evaluación verificado explícitamente.

## Fase 4 — Infraestructura Docker
**Objetivo:** Backend persistente + ejecución efímera de comandos shell aislada.
**Tareas:**
- Dockerfile del backend (contenedor persistente con acceso a red).
- `Ephemeral_Bash_Exec`: contenedor efímero (`alpine`/`node:slim`/`python:slim`) con volumen al workspace activo, `--rm` automático.
- Timeout configurable (default 120s) con `SIGKILL` + destrucción forzada del contenedor si se cuelga.
- Fallo explícito si el daemon Docker no responde (nunca degradar en silencio a ejecución sin sandbox — ver Errores #02).
**Entregables:** Función `runEphemeral(cmd, opts)` testeada con: comando normal, comando que hace timeout, comando que se cuelga.
**DoD:** Ningún contenedor efímero sobrevive al proceso padre (verificar con `docker ps` tras cada test).

## Fase 5 — Registro de Herramientas (`packages/tools`)
**Objetivo:** Todas las tools del agente, con sanitización anti-prompt-injection.
**Tareas:**
- `FileSystem_Read/Write/Delete/Move/Search`, `Edit_Lines` (validación estricta de rangos — ver Errores, evitar bugs de índices).
- `Git_Governance` (status, diff, commit, branch, log) como comandos estructurados, no shell libre.
- `Scrapling` (stealth fetchers) para web scraping.
- `Context_Inspector`, `Session_Checkpoint`.
- Cliente MCP nativo (`@modelcontextprotocol/sdk`) leyendo `.agente/mcp.json`, con spawn robusto en Windows (ruta absoluta a `node.exe`, nunca `npx` sin `shell:true` — ver Errores #08).
- **Envoltura anti prompt-injection**: toda salida de scraping o lectura de archivos se envuelve en bloques delimitados explícitos marcados como `untrusted data` antes de reinyectarla al LLM.
**Entregables:** Cada tool registrada con su schema Zod de entrada/salida.
**DoD:** Test de integración que intenta inyectar una instrucción vía contenido scrapeado y confirma que el agente no la ejecuta como si viniera del usuario.

## Fase 6 — Persistencia y Sesiones
**Objetivo:** SQLite + Drizzle ORM para sesiones, historial y checkpoints.
**Tareas:**
- Esquema Drizzle: sesiones (id, nombre, fechas, workspace, historial, tools ejecutadas, tokens, checkpoints).
- **Activar WAL mode desde el arranque** (evitar la issue abierta en Errores #01) + lock apropiado en accesos concurrentes.
- Operaciones multisesión: crear, renombrar, pausar, clonar (branching), exportar/importar (JSON/Markdown), restaurar checkpoint.
- Memoria semántica (RAG/embeddings) en SQLite.
**Entregables:** `SessionManager` con API CRUD + branching, testeado con SQLite en disco temporal.
**DoD:** Test de escritura concurrente (dos operaciones simultáneas) no corrompe la DB.

## Fase 7 — Ventana de Contexto y Compactación
**Objetivo:** Conteo de tokens y compactación automática.
**Tareas:**
- Contador de tokens por componente (system prompt, reglas, historial, tools).
- Algoritmo de compactación al ~80%: sintetiza mensajes antiguos, inserta `CompactBoundaryMessage`.
- Evento `agent:context_update` con el desglose, para consumo futuro de la UI.
**Entregables:** Función `maybeCompact(session)` testeada con historiales sintéticos que cruzan el umbral.
**DoD:** Tras compactar, se preservan objetivos activos, archivos editados y decisiones clave (verificado por test con fixture de historial largo).

## Fase 8 — Trabajos de Larga Duración
**Objetivo:** Las 5 primitivas de ejecución durable.
**Tareas:**
- External done-condition (`prd.json`/`progress.txt`/`plan.md` en `.agente/`).
- Session log durable append-only en JSONL (replay exacto tras reinicio).
- Harness stateless + sandbox desechable (reutiliza Fase 4).
- Evaluador separado (corre tests/linter/build antes de cerrar una subtarea).
- Checkpointing deliberado (cada N turnos, no cada paso) + HITL pausing (consumo cero mientras espera respuesta humana).
**Entregables:** Escenario de prueba: matar el proceso a mitad de una tarea larga y confirmar que se reanuda exactamente desde el último checkpoint via replay del JSONL.
**DoD:** Cero pérdida de estado tras un "crash" simulado.

## Fase 9 — Skills y Extensibilidad
**Objetivo:** Carga diferida de skills desde `.agente/skills/`.
**Tareas:**
- Escaneo de `.agente/skills/` al inicio, indexando solo `name`+`description` de cada `SKILL.md`.
- Inyección del cuerpo completo solo cuando el agente decide activarla.
**Entregables:** Test con 3 skills de ejemplo, confirmando que el cuerpo no se carga hasta la activación explícita.
**DoD:** Medición de tokens de arranque antes/después confirma que el lazy loading reduce el prompt inicial.

## Fase 10 — Multiproveedor, Resiliencia y Seguridad de Claves
**Objetivo:** Cambiar de proveedor LLM sin tocar código interno, con reintentos y claves seguras.
**Tareas:**
- Capa de abstracción para OpenAI, Anthropic, Gemini, Ollama, OpenRouter, Groq (detrás de `AgentInterface` de Fase 1).
- Backoff exponencial + jitter en 429/503, failover a proveedor secundario configurado.
- Claves en RAM por defecto; opción de persistencia cifrada en disco solo tras confirmación explícita del usuario en la UI.
**Entregables:** Test simulando 429 repetidos que confirma backoff y failover.
**DoD:** Ninguna clave aparece en logs ni en el session log JSONL de la Fase 8.

## Fase 11 — App de Escritorio (Tauri v2)
**Objetivo:** MVP de UI ejecutable con `pnpm tauri dev`.
**Tareas:**
- Scaffold `apps/desktop`: React + Vite + Tailwind + Lucide Icons.
- IPC: escuchar `agent:thought`, `agent:tool_call`, `agent:context_update`.
- Selector nativo de carpeta de workspace → inicializa/lee `.agente/`.
- Panel de sesiones (listar, crear, cambiar, renombrar, eliminar, checkpoints).
- Panel de ajustes (proveedores, API keys, modos de permiso, toggle de herramientas).
- Gauge de ventana de contexto.
- Modal HITL de permisos (conectado al `canUseTool` de la Fase 3).
**Entregables:** App arrancando con `pnpm tauri dev`, workspace seleccionable, sesión creable, ida y vuelta de un prompt simple visible en UI.
**DoD:** Verificación manual: seleccionar carpeta real, crear sesión, mandar prompt que dispare una tool con permiso `ask`, confirmar que el modal HITL aparece y bloquea hasta respuesta.
**Nota:** empaquetado binario (`tauri build`) queda explícitamente pospuesto — solo `tauri dev` en esta fase.

## Fase 12 — Testing Cruzado y QA
**Objetivo:** Cobertura Vitest completa exigida por `prompt.md`.
**Tareas:**
- Unitarios: motor de permisos, compactación, tools, sesiones SQLite, claves en RAM.
- Integración/E2E: Agentic Loop completo, trabajos de larga duración, sanitización anti-injection, ejecución efímera Docker.
- `pnpm test` a nivel raíz corre todo el workspace.
**Entregables:** Reporte de cobertura.
**DoD:** `pnpm test` en verde en CI local; ningún test marcado `skip` sin justificación.

## Fase 13 — Documentación y Cierre de MVP
**Objetivo:** Dejar el repo auto-explicativo para retomar en cualquier momento.
**Tareas:**
- `.agente/rules.md` con reglas globales reales del proyecto.
- README actualizado con instrucciones de arranque (`pnpm install`, `pnpm tauri dev`, `pnpm test`).
- Registrar en el vault (`Base_Conocimientos\Errores`) cualquier error nuevo encontrado durante la implementación, con su fix, siguiendo la plantilla del índice.
**Entregables:** Repo listo para onboarding de un tercero sin contexto previo.
**DoD:** Alguien que solo lee el README y `.agente/rules.md` puede levantar el entorno sin preguntar nada.
