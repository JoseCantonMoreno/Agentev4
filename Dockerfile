# syntax=docker/dockerfile:1
# Backend persistente de Agentev4 (Fase 4): contenedor de larga duración con
# acceso a red para llamar APIs de LLM y hacer scraping. Los comandos Bash del
# agente NO corren aquí: usan contenedores efímeros propios (ver
# packages/tools/src/docker/ephemeral-exec.ts).

FROM node:22-slim AS base
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/tools/package.json packages/tools/package.json
COPY apps/desktop/package.json apps/desktop/package.json
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm build

FROM node:22-slim AS runtime
RUN corepack enable
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app /app
EXPOSE 3000

# ponytail: aún no existe un servidor HTTP/IPC (llega en Fase 11 con el
# sidecar de Tauri); placeholder que mantiene vivo el contenedor persistente
# con red hasta que haya un entrypoint real que reemplace este CMD.
CMD ["node", "--eval", "console.log('agentev4 backend container listo'); setInterval(() => {}, 2 ** 31 - 1);"]
