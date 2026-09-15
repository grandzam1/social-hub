# Inngest test notes

## Results (WSL, 2026-09-13)

| Check | Result |
|-------|--------|
| Inngest Cloud API health | OK |
| Account | zam / production + branch |
| Cloud apps synced | **none** (root cause of prior failure) |
| Cloud event ingest (`inn.gs/e/<key>`) | **200 OK** |
| Local Hono `:8787` | OK |
| Inngest Dev Server `:8288` | OK — apps synced |
| Function `Hello Social` | **ran** on event `social/hello` |

## Why Cloud “did nothing” before

Event keys worked, but **no app URL was registered** in Cloud. Events were accepted and discarded with no worker.

## Paths

- Local (works now): Hono + `inngest-cli dev`
- Cloud functions later: deploy `apps/api` (e.g. Vercel) with `INNGEST_SIGNING_KEY` + `INNGEST_EVENT_KEY`, then sync URL in Inngest dashboard
