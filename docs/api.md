# Social Hub API reference

Source of truth: `apps/api/src/index.ts` (and the libs it calls).  
Base URL (local): `http://127.0.0.1:8787`  
Default port: `PORT` env or **8787**.

**Authentication (this API):** none. Endpoints are open on the bound host (`127.0.0.1`).  
Server-side secrets are read from `.env` (not sent by clients):

| Env | Used by |
|-----|---------|
| `SCRAPECREATORS_API_KEY` | scrape / recent-posts / credits |
| `AIRTABLE_TOKEN` or `AIRTABLE_API_KEY` | scrape / scraps / media save |
| `R2_*` | media save / scrape when saving to R2 |
| `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY`, `INNGEST_DEV` | `/api/inngest`, async media save, `/demo/hello` |

Error shape used by most JSON routes:

```json
{ "ok": false, "error": "human-readable message" }
```

Typical status codes: `400` validation, `500` unexpected / upstream failure.

---

## Table of contents

1. [GET /health](#get-health)
2. [GET\|PUT\|POST /api/inngest](#getputpost-apiinngest)
3. [POST /demo/hello](#post-demohello)
4. [POST /api/media/save](#post-apimediasave)
5. [POST /api/media/save-sync](#post-apimediasave-sync)
6. [POST /demo/save-media](#post-demosave-media-deprecated)
7. [POST /api/scrape-post](#post-apiscrape-post)
8. [GET /api/recent-posts](#get-apirecent-posts)
9. [GET /api/scraps](#get-apiscraps)
10. [GET /api/credits](#get-apicredits)
11. [GET /api/credits/history](#get-apicreditshistory)
12. [GET /api/usage](#get-apiusage)
13. [Static UI routes](#static-ui-routes)
14. [Where each endpoint is used](#where-each-endpoint-is-used)

---

## GET /health

**What it does:** Liveness check plus whether key env vars are present (booleans only; no secrets).

**Auth:** none  
**Inputs:** none

**Success `200` example:**

```json
{
  "ok": true,
  "service": "social-hub-api",
  "inngestDev": true,
  "hasEventKey": true,
  "hasSigningKey": true,
  "hasAirtable": true,
  "hasR2": true,
  "hasScrapeCreators": true
}
```

**Errors:** none defined (always returns JSON).

**Used by:** ops / manual curl; not called from the UI.

---

## GET|PUT|POST /api/inngest

**What it does:** Inngest serve endpoint (`inngest/hono`). Registers and runs functions defined in `apps/api/src/inngest/functions.ts`, including:

- `save-media-to-r2` on event `media/cdn.ready`
- `hello-social` on event `social/hello`

**Auth:** Inngest signing (via Inngest SDK + `INNGEST_SIGNING_KEY` when configured). Not a browser-facing app API.

**Inputs / responses:** Inngest protocol (not application JSON). Point Inngest Dev at:

`http://127.0.0.1:8787/api/inngest`

**Used by:** Inngest Dev / Cloud (`npm run dev:inngest`). Indirectly used when scrape/async save queues `media/cdn.ready`.

---

## POST /demo/hello

**What it does:** Sends Inngest event `social/hello` (smoke test).

**Auth:** none (requires working Inngest wiring)

**Body (JSON, optional):**

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `who` | string | no | defaults to `"WSL"` |

**Success `200`:**

```json
{
  "ok": true,
  "ids": { "ids": ["…"] }
}
```

(`ids` is whatever `inngest.send` returns.)

**Errors:**

| Status | Body |
|--------|------|
| `500` | `{ "ok": false, "error": "…" }` (e.g. Inngest unreachable) |

**Used by:** `scripts/e2e-battle.mjs` — not the UI.

---

## POST /api/media/save

**What it does:** Queues async CDN → R2 → Airtable save by emitting Inngest event `media/cdn.ready`. Does **not** download in the HTTP request.

**Auth:** none (needs Inngest Dev or Cloud)

**Body (JSON):**

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `mediaRecordId` | string | **yes** | Airtable Media record id |
| `postRecordId` | string | no | parent Post record |
| `fileUrl` | string | no | CDN URL override |
| `objectKey` | string | no | R2 object key override |
| `mediaType` | string | no | hint for extension |
| `force` | boolean | no | re-save even if Saved copy exists |

**Success `200`:**

```json
{
  "ok": true,
  "mode": "async",
  "event": "media/cdn.ready",
  "ids": { "ids": ["…"] }
}
```

**Errors:**

| Status | When |
|--------|------|
| `400` | missing `mediaRecordId` → `{ "ok": false, "error": "mediaRecordId required" }` |
| `500` | Inngest / send failure |

**Used by:** `scripts/automate-save-media.mjs` (default async mode). Not called from the UI (UI uses scrape pipeline, which may queue the same event internally).

---

## POST /api/media/save-sync

**What it does:** Runs CDN download → R2 upload → Airtable `Saved copy` **in this request** via `saveMediaCdnToR2`. No Inngest required.

**Auth:** none (needs Airtable + R2 env)

**Body:** same as `/api/media/save` (`mediaRecordId` required).

**Success `200`:**

```json
{
  "ok": true,
  "mode": "sync",
  "result": {
    "ok": true,
    "mediaRecordId": "rec…",
    "fileLink": "https://…",
    "savedCopy": "https://…r2…",
    "bytes": 123456,
    "key": "social-hub/rec…/….mp4",
    "postStatus": { "status": "Saved", "total": 1, "saved": 1 }
  }
}
```

If already saved and `force` is not true, `result` may be:

```json
{
  "ok": true,
  "skipped": true,
  "reason": "already-saved",
  "savedCopy": "https://…",
  "fileLink": "…",
  "mediaRecordId": "rec…"
}
```

**Errors:**

| Status | When |
|--------|------|
| `400` | missing `mediaRecordId` |
| `500` | missing CDN link, download/upload/Airtable failure |

**Used by:** `scripts/automate-save-media.mjs --sync`, `scripts/inspect-stuck.mjs`. Not called from the UI.

---

## POST /demo/save-media (deprecated)

**What it does:** Same as `/api/media/save` (queue `media/cdn.ready`). Kept for older scripts.

**Auth:** none  
**Body / errors:** same as `/api/media/save`.

**Success `200`:**

```json
{
  "ok": true,
  "ids": { "ids": ["…"] },
  "event": "media/cdn.ready"
}
```

**Used by:** `scripts/trigger-save-media.mjs`. Prefer `/api/media/save`.

---

## POST /api/scrape-post

**What it does:** Full pipeline for one post URL:

1. Detect platform (Instagram / TikTok / X)
2. Reject profile-only links
3. ScrapeCreators single-post fetch
4. Upsert Profile / Post / Media in Airtable
5. Optionally save media to R2 (`sync`, `async`, or `none`)

**Auth:** none (needs ScrapeCreators + Airtable; R2 if saving)

**Body (JSON):**

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `url` | string | **yes** | post/reel/tweet URL |
| `saveToR2` | boolean | no | default **true** if omitted (`!== false`) |
| `saveMode` | `"sync"` \| `"async"` | no | omit = auto: async when `media.length > 1`, or sync for one file unless CDN HEAD size &gt; 25MB → async |
| `force` | boolean | no | force R2 re-upload |

**Success `200`** (`ScrapePostResult`):

```json
{
  "ok": true,
  "platform": "x",
  "profile": {
    "id": "rec…",
    "handle": "@elonmusk",
    "name": "Elon Musk",
    "avatar": "https://…"
  },
  "post": {
    "id": "rec…",
    "postId": "1812258574049157405",
    "text": "…",
    "link": "https://x.com/…/status/…",
    "status": "Saved",
    "postType": "image",
    "likes": 123,
    "comments": 4,
    "shares": 5,
    "views": 1000,
    "mediaCount": 1
  },
  "media": [
    {
      "id": "rec…",
      "mediaId": "…",
      "order": 0,
      "type": "image",
      "fileLink": "https://…cdn…",
      "previewLink": "https://…",
      "savedCopy": "https://…r2…",
      "fileStatus": "Saved copy ready",
      "width": 2048,
      "height": 1365
    }
  ],
  "saveMode": "sync",
  "creditsCharged": 1,
  "creditsRemaining": 75,
  "cached": false
}
```

**Errors:**

| Status | Examples |
|--------|----------|
| `400` | `{ "ok": false, "error": "url required" }` |
| `500` | unsupported link, profile URL rejected, ScrapeCreators / Airtable / R2 errors — `{ "ok": false, "error": "…" }` |

**Used by:**

- UI Pull media: `apps/api/public/ui.js`
- UI Batch download selected: `apps/api/public/batch.js`

---

## GET /api/recent-posts

**What it does:** Lists a creator feed for selection. **Fetch only** — no Airtable upsert, no R2.

Platforms (from code):

| `platform` | ScrapeCreators path |
|------------|---------------------|
| `x` | `/v1/twitter/user-tweets` |
| `instagram` | `/v2/instagram/user/posts` |
| `tiktok` | `/v3/tiktok/profile/videos` (`sort_by=latest`) |

**Auth:** none (needs `SCRAPECREATORS_API_KEY`)

**Query:**

| Param | Required | Default | Notes |
|-------|----------|---------|-------|
| `platform` | **yes** | — | `x` \| `instagram` \| `tiktok` |
| `handle` | **yes** | — | with or without `@` |
| `limit` | no | `24` | clamped 1–50 in lib |
| `cursor` | no | — | IG `next_max_id` / TikTok `max_cursor` |

**Success `200`:**

```json
{
  "ok": true,
  "platform": "x",
  "handle": "@elonmusk",
  "note": "X returns popular posts (not a true chronological feed).",
  "creditsCharged": 1,
  "creditsRemaining": 74,
  "posts": [
    {
      "id": "1812258574049157405",
      "platform": "x",
      "url": "https://x.com/elonmusk/status/1812258574049157405",
      "handle": "@elonmusk",
      "name": "Elon Musk",
      "caption": "…",
      "postedAt": "2024-07-13T22:51:28.000Z",
      "thumbnail": "https://pbs.twimg.com/media/….jpg",
      "mediaType": "image",
      "mediaCount": 1,
      "width": 2048,
      "height": 1365,
      "likes": 123,
      "comments": 4,
      "views": 1000
    }
  ],
  "nextCursor": "…"
}
```

(`note` / `nextCursor` only when the lib sets them.)

**Errors:**

| Status | When |
|--------|------|
| `400` | bad/missing `platform` or empty `handle` |
| `500` | ScrapeCreators failure |

**Used by:** UI Batch page — `apps/api/public/batch.js`.

---

## GET /api/scraps

**What it does:** Builds the Saved Scraps library from Airtable Posts + Media (`listScraps`).

**Auth:** none (needs Airtable)

**Query:**

| Param | Required | Default | Notes |
|-------|----------|---------|-------|
| `type` | no | `all` | `all` \| `text` \| `image` \| `video` |
| `user` | no | `""` | exact author handle match; `all` ignored |
| `q` | no | `""` | case-insensitive search in text / user / platform / post link |

**Success `200`:**

```json
{
  "ok": true,
  "items": [
    {
      "id": "media:rec…",
      "kind": "image",
      "text": "caption…",
      "previewUrl": "https://…",
      "fileUrl": "https://…",
      "user": "@natgeo",
      "platform": "instagram",
      "postLink": "https://…",
      "postRecordId": "rec…",
      "mediaRecordId": "rec…",
      "savedAt": "2026-09-13T…",
      "fileStatus": "Saved copy ready",
      "order": 0
    }
  ],
  "users": ["@elonmusk", "@natgeo"],
  "counts": { "all": 40, "text": 2, "image": 20, "video": 18 }
}
```

**Errors:**

| Status | When |
|--------|------|
| `500` | Airtable failure → `{ "ok": false, "error": "…" }` |

**Used by:** UI Saved Scraps — `apps/api/public/scraps.js`.

---

## GET /api/credits

**What it does:** Returns ScrapeCreators remaining credit balance (`GET /v1/account/credit-balance`).

**Auth:** none (needs `SCRAPECREATORS_API_KEY`)

**Inputs:** none

**Success `200`:**

```json
{ "ok": true, "remaining": 76 }
```

**Errors:** `500` with `{ "ok": false, "error": "…" }`

**Used by:** UI credits chip — `apps/api/public/credits.js` (all pages that include it).

---

## GET /api/credits/history

**What it does:** Remaining balance + sanitized recent API usage (`GET /v1/account/get-api-usage`). Secrets (`api_key`, IPs, etc.) are stripped in `getCreditUsage`.

**Auth:** none (needs `SCRAPECREATORS_API_KEY`)

**Query:**

| Param | Required | Default |
|-------|----------|---------|
| `page` | no | `1` (clamped 1–100 in lib) |

**Success `200`:**

```json
{
  "ok": true,
  "remaining": 76,
  "page": 1,
  "history": [
    {
      "id": "…",
      "endpoint": "/v1/twitter/tweet?url=…",
      "route": "/v1/twitter/tweet",
      "statusCode": 200,
      "credits": 1,
      "success": true,
      "cacheHit": false,
      "durationMs": 1100,
      "at": "2026-09-13T19:29:03.614742+00:00"
    }
  ]
}
```

**Errors:** `500` with `{ "ok": false, "error": "…" }`

**Used by:** UI credits panel — `apps/api/public/credits.js`.

---

## GET /api/usage

**What it does:** Summarizes local `usage_events` (Airtable API request counts, R2 upload bytes, optional ScrapeCreators credit snapshots) and returns **live** ScrapeCreators balance. Does not invent vendor quotas. See `docs/usage-events.md`.

**Auth:** none (needs Airtable when `AIRTABLE_USAGE_EVENTS_TABLE` is set; ScrapeCreators for live credits)

**Success `200` (shape):**

```json
{
  "ok": true,
  "configured": true,
  "creditsRemaining": 76,
  "creditsSource": "scrapecreators",
  "airtableRequests": 12,
  "r2UploadBytes": 1234567,
  "r2UploadCount": 3,
  "lastCreditSnapshot": 76,
  "lastCreditSnapshotAt": "2026-09-15T08:00:00.000Z",
  "byDay": [{ "day": "2026-09-15", "airtableRequests": 12, "r2UploadBytes": 1234567 }],
  "events": []
}
```

When the table env var is unset: `configured: false` and empty aggregates.

**Used by:** Admin web UI `/usage`.

---

## Static UI routes

These are HTML/CSS/JS assets served by the same Hono app (not JSON APIs):

| Method | Path | File |
|--------|------|------|
| GET | `/` | `public/index.html` |
| GET | `/batch` | `public/batch.html` |
| GET | `/scraps` | `public/scraps.html` |
| GET | `/docs/api` | HTML view of this document |
| GET | `/docs/api.md` | raw markdown |
| GET | `/ui.css`, `/ui.js`, `/scraps.js`, `/credits.js`, `/batch.js` | public assets |

---

## Where each endpoint is used

| Endpoint | UI | Scripts / other |
|----------|----|-----------------|
| `GET /health` | — | manual |
| `/api/inngest` | — | Inngest Dev/Cloud |
| `POST /demo/hello` | — | `scripts/e2e-battle.mjs` |
| `POST /api/media/save` | — (scrape may emit same event) | `scripts/automate-save-media.mjs` |
| `POST /api/media/save-sync` | — | `automate-save-media.mjs --sync`, `inspect-stuck.mjs` |
| `POST /demo/save-media` | — | `scripts/trigger-save-media.mjs` |
| `POST /api/scrape-post` | `/` (`ui.js`), `/batch` (`batch.js`) | — |
| `GET /api/recent-posts` | `/batch` (`batch.js`) | — |
| `GET /api/scraps` | `/scraps` (`scraps.js`) | — |
| `GET /api/credits` | all pages (`credits.js`) | — |
| `GET /api/credits/history` | all pages (`credits.js`) | — |

---

## Related docs

- [standalone-api.md](./standalone-api.md) — sync vs async media save without Cursor
- [carousel.md](./carousel.md) — carousel order / parent Saved rules
- [media-r2-pipeline.md](./media-r2-pipeline.md) — R2 pipeline notes
- [../WORKFLOWS.md](../WORKFLOWS.md) — end-to-end workflow diagrams

*Generated from the codebase as of the API surface in `apps/api/src/index.ts`. Do not invent endpoints that are not listed here.*
