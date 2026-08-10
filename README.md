# Agentev4

Plataforma personal de agente de codificación autónomo: app de escritorio
(Tauri v2 + React) sobre un sidecar Node que orquesta un agentic loop con
motor de permisos, sesiones persistentes en SQLite, tools con Docker efímero
y soporte multiproveedor de LLM.

Repo inicializado con flujo obligatorio de pull request en `main` (ver
[COMANDOS-GIT.md](COMANDOS-GIT.md)). Convenciones reales del proyecto en
[.agente/rules.md](.agente/rules.md).

## Requisitos previos

- Node.js >= 20 y `pnpm` (`corepack enable` si no está activo).
- [Docker](https://www.docker.com/) corriendo — las tools de shell del agente
  se ejecutan en contenedores efímeros, no en el host.
- Toolchain de Rust ([rustup](https://rustup.rs/)) para compilar el shell de
  Tauri v2 (`apps/desktop/src-tauri`).
- Una clave de API de al menos un proveedor LLM soportado
  (`anthropic`, `gemini`, `openai`, `ollama`, `openrouter`, `groq`) — se
  introduce desde el panel de ajustes de la app en runtime, no por variable
  de entorno ni fichero versionado.

## Arranque

```bash
pnpm install
```

En una terminal, levanta el frontend de desarrollo:

```bash
pnpm --filter @agentev4/desktop dev
```

En otra, inicia Tauri:

```bash
pnpm tauri dev
```

Este segundo comando compila el sidecar (`apps/desktop/server`) y se conecta
al frontend en `http://localhost:1420` para levantar la app de
escritorio con recarga en caliente. Al abrir, selecciona una carpeta de
workspace real, crea una sesión, añade tu clave de proveedor en Ajustes y
manda un prompt.

## Tests

```bash
pnpm test            # suite completa del workspace (Vitest)
pnpm test:coverage    # igual, con reporte de cobertura V8 en coverage/
```

Requiere Docker corriendo (algunas pruebas de ejecución efímera lo usan de
verdad, no lo mockean).

## Otros scripts de la raíz

```bash
pnpm build   # tsc -b en todos los paquetes referenciados
pnpm lint    # eslint .
pnpm format  # prettier --write .
```

## Estructura del monorepo

```
apps/desktop/        # Tauri v2 + React (frontend) + server/ (sidecar Node/IPC)
packages/shared/      # tipos y esquemas Zod compartidos
packages/tools/       # registro de tools: FS, git, Docker efímero, MCP bridge
packages/core/        # agentic loop, permisos, sesiones SQLite, skills, resiliencia
PLAN-FASES.md          # plan de implementación por fases (histórico + referencia)
```
