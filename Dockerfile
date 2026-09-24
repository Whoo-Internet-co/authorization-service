# syntax=docker/dockerfile:1
#
# Dockerfile multi-stage mínimo (node:22-alpine) com 3 targets de runtime:
#   - api   : HTTP NestJS (dist/main.js)
#   - relay : Outbox Relay (dist/relay/outbox-relay.js)
#   - tools : scripts de infra (init-local-tables.mjs) — usado no compose
#
# A dependência privada @whoo-internet-co/finance-platform-contracts exige auth
# no `npm ci`. O token é injetado via BuildKit secret (id=npmrc) apontando para
# um arquivo .npmrc com `//npm.pkg.github.com/:_authToken=...`. Ele NÃO entra
# em nenhuma camada: os stages de runtime partem de node:22-alpine limpo e
# copiam apenas node_modules + dist.
#
# Build local:
#   docker build --secret id=npmrc,src=$HOME/.npmrc --target api   -t authorization-service:api .
#   docker build --secret id=npmrc,src=$HOME/.npmrc --target relay -t authorization-service:relay .

# ---- deps: instala TODAS as dependências (dev incl., p/ build) ----
FROM node:22-alpine AS deps
WORKDIR /app
# .npmrc do projeto (apenas registry escopado, sem token) + manifests.
COPY .npmrc package.json package-lock.json ./
RUN --mount=type=secret,id=npmrc,target=/root/.npmrc \
    npm ci

# ---- build: compila TypeScript -> dist ----
FROM deps AS build
WORKDIR /app
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

# ---- prod-deps: somente dependências de runtime ----
FROM node:22-alpine AS prod-deps
WORKDIR /app
COPY .npmrc package.json package-lock.json ./
RUN --mount=type=secret,id=npmrc,target=/root/.npmrc \
    npm ci --omit=dev && npm cache clean --force

# ---- runtime-base: node_modules de produção + dist ----
FROM node:22-alpine AS runtime-base
ENV NODE_ENV=production
WORKDIR /app
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./
USER node

# ---- api ----
FROM runtime-base AS api
EXPOSE 3000
CMD ["node", "dist/main.js"]

# ---- relay ----
FROM runtime-base AS relay
CMD ["node", "dist/relay/outbox-relay.js"]

# ---- tools (init de tabelas/filas locais) ----
FROM prod-deps AS tools
WORKDIR /app
COPY scripts ./scripts
CMD ["node", "scripts/init-local-tables.mjs"]
