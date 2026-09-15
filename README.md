# social-hub

Organized monorepo for social scrape → normalize → Airtable → R2.

## Layout

| Path | Purpose |
|------|---------|
| `apps/api` | Hono HTTP API + Inngest + legacy vanilla UI (`public/`) |
| `apps/web` | **shadcn admin UI** (Vite + React) — preferred local frontend |
| `packages/shared` | Shared types / normalize helpers |
| `scripts` | One-off cloud tests |
| `docs` | Notes |

## Quick start (WSL)

```bash
cd ~/workspace/social-hub
cp .env.example .env
# fill keys; keep SC_MODE=cache for local (avoids hard-fail / burns fewer credits)
npm run install:api
npm run install:web

# API + admin UI together
npm run dev

# or separately:
npm run dev:api   # http://127.0.0.1:8787
npm run dev:web   # http://127.0.0.1:5173  (proxies /api → :8787)
```

Admin routes (web): `/` Pull · `/batch` · `/scraps` · `/settings` · `/docs`

Legacy vanilla pages stay on the API origin (`/`, `/batch`, `/scraps`) until you deprecate them.

Optional Inngest:

```bash
npm run dev:inngest
```

## Cloud

```bash
npm run e2e:cloud
npm run cf:deploy
```
