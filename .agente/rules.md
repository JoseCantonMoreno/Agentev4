# Reglas globales — Agentev4

Reglas reales del proyecto, extraídas de lo que ya está implementado (no
aspiracionales). Si una regla de aquí deja de ser cierta en el código, gana el
código: actualiza este archivo en el mismo PR que rompa la regla.

## Estructura

Monorepo pnpm (`apps/*`, `packages/*`), TypeScript estricto, ESM (`"type": "module"`
en todos los `package.json`). `tsconfig.base.json` en la raíz, cada paquete extiende
y usa referencias de proyecto (`tsc -b`).

- `packages/shared` — tipos y esquemas Zod puros, sin dependencias del resto del monorepo.
- `packages/tools` — registro de tools (`defineTool`/`executeRegisteredTool`), FS, git, Docker efímero, MCP bridge. Depende solo de `shared`.
- `packages/core` — agentic loop, motor de permisos, sesiones SQLite (Drizzle + better-sqlite3), compactación, resiliencia multiproveedor, claves en RAM, carga de skills. Depende de `shared` + `tools`.
- `apps/desktop` — Tauri v2 + React. `server/` es el sidecar Node que habla con `core` vía IPC; el frontend nunca importa `core`/`tools` directamente.

## Motor de permisos

Cuatro modos en `PermissionEngine` (`packages/core/src/permission-engine.ts`):
`bypassPermissions` (todo permitido), `plan` (solo lectura, cualquier tool con
efectos se deniega), `acceptEdits` (tools de edición auto-aprobadas, el resto
sigue las reglas), `default` (reglas `allow`/`ask`/`deny` por nombre de tool, y
`ask` bloquea el loop hasta que el HITL responde). Nunca se ejecuta una tool
antes de pasar por `evaluate()` — ver `agentic-loop-e2e.integration.test.ts`
para el cableado completo real (permisos + registry + sesión).

## Ejecución de comandos

Los comandos Bash del agente corren en contenedores Docker **efímeros** (uno
por invocación, `packages/tools/src/docker/ephemeral-exec.ts`), nunca en el
host ni en el contenedor persistente del `Dockerfile` raíz (ese es solo para
red saliente a APIs de LLM/scraping). Sin Docker corriendo, esas tools y sus
tests fallan — es un requisito duro del entorno, no opcional.

## Claves de proveedor LLM

En RAM por defecto (`packages/core/src/security/key-store.ts`), nunca en el
repo ni en `.env` versionado. Persistencia en disco es opt-in explícito del
usuario y siempre cifrada. Se configuran desde el panel de ajustes de la app
en runtime, no por variable de entorno (la única excepción es
`packages/core/src/scripts/run-example.ts`, un script manual de humo, no
código de producción).

## Sesiones

SQLite por sesión vía `SessionManager`. El directorio `.agente/` dentro del
**workspace que el usuario selecciona en la app** (no este repo, salvo que
alguien apunte la app a sí misma) guarda `sessions.db`, `checkpoints/`,
`skills/` y `mcp.json` — es runtime del agente, no se versiona ahí. El único
`.agente/` versionado es el de la raíz de este repo, y solo para `rules.md`.

## Testing

Vitest en modo workspace (`vitest.workspace.ts`, 4 proyectos: `shared`,
`core`, `tools`, `desktop`), todos con `passWithNoTests: true`. `pnpm test`
en la raíz corre todo. Prohibido marcar tests `skip`/`todo` sin justificar por
qué en el propio test. Los módulos que dependen de un LLM real o del adaptador
Mastra concreto (`mastra-agent.ts`, `apps/desktop/server/src/index.ts`) se
prueban sustituyendo un `AgentInterface` guionizado en vez de mockear el SDK
o llamar a un proveedor real — patrón establecido en Fase 2 y reutilizado
siempre después. `pnpm test:coverage` genera el reporte V8 (`coverage/`, no
versionado, regenerable).

## Commits y flujo de PR

Conventional Commits (`commitlint.config.js`), un PR por fase del plan
(`PLAN-FASES.md`), squash-merge con borrado de rama. Nunca commitear
directamente a `main`. Ver `COMANDOS-GIT.md` para el detalle del flujo.

## Errores

Todo bug real encontrado durante el desarrollo (no solo hipótesis) se
registra en el vault de Obsidian (`Base_Conocimientos/Errores`) con la
plantilla síntoma → causa raíz → diagnóstico → solución → prevención antes de
cerrar la fase en la que se encontró.
