# Usage & limits audit

**Scope:** Inventory of external services, API calls, credits, storage metrics, and usage/limit handling that are **verifiable from this repository**.  
**Date:** 2026-09-15  
**Method:** Code and docs search only. No runtime probes. No guesses about vendor plan numbers unless the repo states them.

---

## Summary

| Service | Used in runtime app? | Measurable in-repo today | Persisted locally? | Track ourselves? |
|---------|----------------------|--------------------------|--------------------|------------------|
| ScrapeCreators | Yes | Credit balance + usage history (vendor API) | No (live fetch / disk cache of responses) | Optional snapshots; vendor is source of truth |
| Airtable | Yes | Per-request success/429; record page sizes | No call counter | Yes, if we need call/volume history |
| Cloudflare R2 | Yes | Bytes per upload/download in that request | Bytes returned in save result only | Yes, for bucket totals / trends |
| Cloudflare Workers | Yes (deploy) | Health env booleans only | No | Only if CF dashboard is insufficient |
| Inngest | Yes | Function concurrency config (`5`); retries (`3`) | No usage meter | Optional; Inngest dashboard exists outside repo |
| Platform CDNs (X / IG / TikTok) | Yes (download + thumb proxy) | Per-object `bytes` / `Content-Length` | No aggregate | Optional (egress/bandwidth) |
| Composio | **No** (env example / scripts notes only) | Nothing in app | N/A | Only if integrated |
| Google Fonts / jsDelivr | Vanilla UI assets only | Not metered | No | No |
| GitHub Actions | CI deploy only | Workflow secrets present | No | No (CI minutes outside app) |
| Local SC cache/fixtures | Local disk | File sizes via `scripts/sc.mjs` | Yes (files) | Already local; not a SaaS quota |

There is **no** dedicated Airtable (or other) table in this repo for usage, quotas, credits, storage size, or API limits.

Airtable data tables configured in code: **Posts**, **Media**, **Profiles** only (see env defaults below).

---

## 1. ScrapeCreators

### What we call

Base: `https://api.scrapecreators.com`  
Auth: header `x-api-key` from `SCRAPECREATORS_API_KEY`  
Implementation: `apps/api/src/lib/scrapecreators.ts`, also `scripts/sc.mjs` / dump scripts.

| Path | Purpose |
|------|---------|
| `/v1/instagram/post` | Scrape IG post |
| `/v1/tiktok/video` | Scrape TikTok video |
| `/v1/twitter/tweet` | Scrape X post |
| `/v1/twitter/user-tweets` | X feed for batch |
| `/v2/instagram/user/posts` | IG feed for batch |
| `/v3/tiktok/profile/videos` | TikTok feed for batch |
| `/v1/account/credit-balance` | Remaining credits (`creditCount`) |
| `/v1/account/get-api-usage` | Paginated usage rows |

### What we can measure (from code)

| Metric | Source | Exposed how |
|--------|--------|-------------|
| Remaining credits | `GET /v1/account/credit-balance` → `creditCount` | `GET /api/credits` → `{ remaining }` |
| Per-call credits, route, status, success, cache hit, duration, timestamp | `GET /v1/account/get-api-usage` | `GET /api/credits/history` → `history[]` |
| Credits charged / remaining on scrape responses | Vendor JSON fields `credits_charged`, `credits_remaining` normalized in `normalize.ts` / `recent-posts.ts` | Returned on scrape/recent-posts JSON |

`CreditUsageRow` fields (sanitized in `getCreditUsage`): `id`, `endpoint`, `route`, `statusCode`, `credits`, `success`, `cacheHit`, `durationMs`, `at`.

### Limits / controls in repo

| Control | Evidence |
|---------|----------|
| `SC_MODE=cache\|offline\|live` | `sc-cache.ts`, `.env.example`, `work-smart.md` |
| Disk cache / fixtures to avoid live calls | `.cache/scrapecreators/`, `fixtures/scrapecreators/` |
| Vendor free cache window | `SC_VENDOR_CACHE_HOURS` → query `cache_max_age` (comment: “0 credits on hit”) |
| Docs/scripts note rate limits | `docs/work-smart.md`: “We hit ScrapeCreators rate limits”; `scripts/e2e-cloud.mjs` avoids live scrapes by default |
| Cloud Worker defaults to live | `wrangler.jsonc` / `worker.ts`: `SC_MODE=live`, `SC_CACHE_WRITE=0` |

**Not in codebase:** numeric rate-limit thresholds, plan caps, or a local credit ledger table.

### Track ourselves?

**Not required for balance/history** — vendor APIs already provide them and the UI/API proxy them.  
**Optional** if we want durable snapshots, alerts when `remaining` drops, or offline history when SC is unreachable (`/api/credits` already soft-fails with `remaining: null`).

---

## 2. Airtable

### What we call

Base: `https://api.airtable.com/v0/{AIRTABLE_BASE_ID}/…`  
Auth: `Bearer` `AIRTABLE_TOKEN` or `AIRTABLE_API_KEY`  
Implementation: `apps/api/src/lib/airtable.ts`.

Default IDs (code + `.env.example` + `wrangler.jsonc` vars):

| Env | Default |
|-----|---------|
| `AIRTABLE_BASE_ID` | `appkPrLfwDGwIIbTL` |
| `AIRTABLE_POSTS_TABLE` | `tblxevZB9wCX1N3WF` |
| `AIRTABLE_MEDIA_TABLE` | `tbly36b1qJiRbfEL2` |
| `AIRTABLE_PROFILES_TABLE` | `tblD49NYtqd3vdOTI` |

Operations: list/find/create/update on Posts, Media, Profiles; used by scrape upsert, scraps library, media save status.

Script-only: `scripts/dump-airtable-schema.mjs` calls Meta API  
`https://api.airtable.com/v0/meta/bases/{base}/tables` (not used by the Hono app).

### What we can measure (from code)

| Metric | Source | Persisted? |
|--------|--------|------------|
| HTTP status including **429** | `airtableFetch` retries on 429 / 5xx (3 attempts, backoff) | Log line only (`console.warn`) |
| Page size caps | `listMedia` / `listProfiles` clamp `pageSize` to **100**; list defaults 50/100 | N/A |
| Record counts in a single list response | Length of returned `records` (e.g. scraps loads posts/media/profiles) | Not aggregated |

### Limits / controls in repo

- Retry on `429` and network/5xx (`airtable.ts`).
- **No** counter of Airtable API calls, **no** storage-size field, **no** quota table, **no** documented numeric Airtable rate limit in this repo.

### Track ourselves?

**Yes, if we care about Airtable API volume or base growth** — the repo does not store that today.  
Measuring **base attachment/storage size** is not implemented; R2 holds saved media copies, not Airtable attachment metering.

---

## 3. Cloudflare R2

### What we call

S3-compatible client: `@aws-sdk/client-s3`  
Endpoint: `https://{R2_ACCOUNT_ID}.r2.cloudflarestorage.com`  
Credentials: `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`  
Bucket: `R2_BUCKET` (default `scrape-kit-media`)  
Public URL base: `R2_PUBLIC_BASE_URL` (default `https://pub-dd096d99ffc0494a9164b431ea60c9c6.r2.dev`)  
Implementation: `apps/api/src/lib/r2.ts` → `PutObjectCommand` only.

### What we can measure (from code)

| Metric | Source |
|--------|--------|
| Bytes downloaded from CDN | `downloadCdnUrl` → `buffer.length` |
| Optional pre-size | `headCdnUrl` → `Content-Length` header |
| Bytes uploaded | `uploadToR2` → `bytes: options.body.length` |
| Per-save result | `saveMediaCdnToR2` returns `bytes` on success |

### Limits / controls in repo

- Sync download abort timeout **180s** (`downloadCdnUrl`).
- HEAD timeout **15s**.
- Inngest save concurrency **5** (see Inngest) to avoid CDN/R2 stampede (comment in `functions.ts`).

**Not in codebase:** `ListObjects`, bucket size totals, R2 class A/B op counts, or storage quota numbers.

### Track ourselves?

**Yes for total storage / growth** — only per-object upload bytes exist today; no inventory sum.  
Vendor Cloudflare dashboard is outside this repo and not queried by the app.

---

## 4. Cloudflare Workers (hosting)

### What we use

- Deploy: `.github/workflows/deploy-cloudflare.yml` via `cloudflare/wrangler-action@v3` with `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`.
- Runtime: `apps/api/src/worker.ts`, `wrangler.jsonc` (`name: social-hub`, `assets` → `ASSETS` binding).
- Production URL appears in scripts (e.g. `https://social-hub.kelvinchristian144.workers.dev`).

### What we can measure (from code)

| Metric | Source |
|--------|--------|
| Env presence | `GET /health` booleans: Airtable, R2, ScrapeCreators, Inngest keys |

**Not in codebase:** Worker request counts, CPU time, or billing metrics.

### Track ourselves?

**Only if dashboard metrics are insufficient** — app does not pull CF analytics.

---

## 5. Inngest

### What we call

- SDK client `apps/api/src/inngest/client.ts` (`INNGEST_EVENT_KEY`).
- Serve route `GET|PUT|POST /api/inngest` (`INNGEST_SIGNING_KEY` / `INNGEST_DEV`).
- Events: `media/cdn.ready`, `social/hello` (and sends from scrape/demo routes).
- Local: `npm run dev:inngest` → `inngest-cli` against `http://127.0.0.1:8787/api/inngest`.

### What we can measure (from code)

| Metric | Source |
|--------|--------|
| Function concurrency | `save-media-to-r2`: `concurrency: [{ limit: 5 }]` |
| Retries | `retries: 3` on that function |
| Send acknowledgement | `inngest.send` return value (`ids`) in API responses |

**Not in codebase:** account step/run quotas, billing, or a local usage table.

### Track ourselves?

**Optional.** App-enforced concurrency is already set; account-level limits are not read from Inngest APIs in this repo.

---

## 6. Platform CDNs (media download & thumb proxy)

### What we call

- **Download / HEAD** of original media URLs in `r2.ts` (`downloadCdnUrl`, `headCdnUrl`) during R2 save.
- **Thumb proxy** `GET /api/thumb?url=…` in `app.ts` — allowlisted hosts only (twimg, Instagram CDN hosts, TikTok-related host patterns).

### What we can measure (from code)

| Metric | Source |
|--------|--------|
| Response body size (download) | `bytes` on download/upload |
| `Content-Length` (HEAD) | optional, may be missing |
| Thumb proxy buffer size | `arrayBuffer().byteLength` (not logged/stored) |

**Not in codebase:** bandwidth quotas for these CDNs, or aggregate egress tracking.

### Track ourselves?

**Optional** for ops cost/debug; not required for product credits.

---

## 7. Composio

### Evidence in repo

- `.env.example`: `COMPOSIO_API_KEY`, `COMPOSIO_USER_ID`, `COMPOSIO_AIRTABLE_ACCOUNT_ID` (“optional for agent tooling”).
- `scripts/merge-scrape-kit-env.py` copies those keys.
- `scripts/e2e-battle.mjs` comment: Airtable write may use Composio “for that leg” when key missing.

### Runtime app (`apps/`)

**Zero** references to `COMPOSIO` / `composio` under `apps/` (verified by search).

### What we can measure

Nothing in the application code path.

### Track ourselves?

**No, until Composio is integrated.** Env placeholders alone are not usage.

---

## 8. Ancillary / non-product services

| Service | Where | Metered in app? | Track ourselves? |
|---------|-------|-----------------|------------------|
| Google Fonts | Vanilla `public/*.html` stylesheet links | No | No |
| jsDelivr (`marked`) | `api-docs.html` | No | No |
| GitHub Actions | Deploy workflow | No app metrics | No |
| Browser `localStorage` | Zustand persist (`batch-store`); catch “quota” | Browser storage only | No |

---

## 9. Application-level clamps (not vendor quotas)

| Clamp | Value | File |
|-------|-------|------|
| `/api/recent-posts` `limit` | 1–50 | `recent-posts.ts` |
| Airtable list `pageSize` (media/profiles) | max 100 | `airtable.ts` |
| Credits history `page` | 1–100 | `scrapecreators.ts` |
| Inngest media-save concurrency | 5 | `inngest/functions.ts` |
| CDN download timeout | 180_000 ms | `r2.ts` |

These are **our** request shaping, not discovered vendor plan limits.

---

## 10. Gaps vs. a “central usage/limits table”

| Desired area | Repo status |
|--------------|-------------|
| User / SC credits | Live vendor APIs + UI; optional **credit_snapshot** rows in `usage_events` |
| Credit usage history | Live vendor API; **no** own full history table |
| DB / Airtable storage size | **Not measured** |
| Airtable API call volume | **Tracked** via `usage_events` (`api_request`) when `AIRTABLE_USAGE_EVENTS_TABLE` is set |
| Composio usage / limits | **Not used** in app |
| R2 total storage / ops | Per-upload `upload_bytes` in `usage_events` (loaded window, not full bucket inventory) |
| Inngest account usage | Concurrency config only |
| Cross-service dashboard | Admin **`/usage`** + `GET /api/usage` (see `docs/usage-events.md`) |

---

## 11. Recommendation (audit conclusion only)

From this codebase alone:

1. **Do not invent quotas** that are not returned by vendor APIs or encoded here.
2. **ScrapeCreators** — already queryable; own table is optional (snapshots/alerts).
3. **Airtable + R2** — instrumented into `usage_events` when configured (see `docs/usage-events.md`).
4. **Composio** — out of scope until code calls it.

No code was modified for the original audit beyond adding this document; usage tracking was added later per product request.
