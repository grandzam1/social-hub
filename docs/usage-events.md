# Usage events (local ledger)

Append-only Airtable table for **our** instrumentation. Does **not** invent vendor quotas.

## What is tracked

| Service | Metric | Delta | Unit | When |
|---------|--------|-------|------|------|
| `airtable` | `api_request` | `1` | `count` | Each HTTP response from `airtableFetch` (retries included). Writes to this table are **not** tracked (no recursion). |
| `r2` | `upload_bytes` | byte length | `bytes` | After successful `PutObject` in `uploadToR2` |
| `scrapecreators` | `credit_snapshot` | remaining balance | `credits` | Optional snapshot when `/api/credits*` or `/api/usage` successfully reads balance (throttled: same value ≤ once / 15 min) |

**Source of truth for ScrapeCreators credits:** still `GET /v1/account/credit-balance` via `/api/credits`. Snapshots are historical only.

**Not tracked (by design):** Composio, Cloudflare Workers metrics, Inngest account usage.

## Create the Airtable table

### Option A — script (Meta API)

```bash
# from repo root, with AIRTABLE_TOKEN + AIRTABLE_BASE_ID in .env
node scripts/create-usage-events-table.mjs
```

Prints the new table id. Add it to `.env` / Worker secrets as `AIRTABLE_USAGE_EVENTS_TABLE`.

### Option B — manual

Create table **`usage_events`** in the same base with fields:

| Field | Type |
|-------|------|
| Label | Single line text (**primary**) — e.g. `airtable:api_request` |
| Service | Single select: `airtable`, `r2`, `scrapecreators` |
| Metric | Single select: `api_request`, `upload_bytes`, `credit_snapshot` |
| Delta | Number |
| Unit | Single select: `count`, `bytes`, `credits` |
| Path | Single line text |
| Method | Single line text |
| Status Code | Number |
| Detail | Long text |
| Occurred At | Date (include time) — optional; record `createdTime` is used if empty |

Then set:

```bash
AIRTABLE_USAGE_EVENTS_TABLE=tblXXXXXXXX
```

Until this env var is set, recording is a no-op and `/api/usage` returns `configured: false`.

## API

`GET /api/usage` — simple list of services with **given / used / remaining** (null when unknown).

- **ScrapeCreators:** `remaining` from live credit balance; `used` from their usage log; `given` = remaining + used when both exist (not a plan quota).
- **Airtable / R2:** `used` from `usage_events` only; `given` / `remaining` stay `null` (no vendor quota in-app).

Admin UI: **`/usage`**.
