# WMS

pnpm monorepo for a warehouse management system.

## Setup

```bash
corepack enable
corepack prepare pnpm@10.18.3 --activate
pnpm install
cp .env.example .env
pnpm docker:up
pnpm dev
```

If `corepack enable` fails on Windows (permissions under `C:\Program Files\nodejs`), use `corepack pnpm` instead of `pnpm`.

## Workspaces

- `apps/api` — TypeScript HTTP API (`@wms/api`)
- `apps/web` — Vite + React UI (`@wms/web`)
- `packages/shared` — shared types (`@wms/shared`)

Local Postgres (`5432`) and Redis (`6379`) are defined in `docker-compose.yml`.
