# social-hub

Organized monorepo for social scrape → normalize → Airtable.

## Layout

| Path | Purpose |
|------|---------|
| `apps/api` | Hono HTTP API + Inngest serve endpoint |
| `packages/shared` | Shared types / normalize helpers |
| `scripts` | One-off cloud tests |
| `docs` | Notes |

## Quick start (WSL)

```bash
cd ~/workspace/social-hub
cp .env.example .env
# fill INNGEST_EVENT_KEY + INNGEST_SIGNING_KEY
npm install

# terminal 1
npm run dev:api

# terminal 2
npm run dev:inngest
```

Then open http://127.0.0.1:8288 (Inngest Dev UI) and POST http://127.0.0.1:8787/demo/hello

## Cloud key smoke test

```bash
npm run test:inngest-cloud
```
