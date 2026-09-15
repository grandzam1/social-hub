# Media pipeline: CDN → R2 → Airtable

## Goal

After scrape, keep the **original CDN URL** and also store a **permanent copy on Cloudflare R2**. Airtable should prefer our R2 URL for display/download.

## Airtable field map (Media table)

| Field | Meaning |
|-------|---------|
| **File link** | Original platform CDN (Twitter/IG/TikTok) — **keep forever** |
| **Preview link** | Original thumb CDN (optional) |
| **Saved copy** | Our R2 public URL — **this is the hosted copy** |
| **File status** | `File link ready` → after R2 → `Saved copy ready` |

Posts **Status** moves to `Saved` when media is on R2.

## Flow

```text
scrape media
  → write Media row (File link = CDN, status = File link ready)
  → emit media/cdn.ready
      → download CDN bytes (highest quality URL from scrape)
      → upload R2 key: social-hub/{mediaRecordId}/{ts}.{ext}
      → PATCH Saved copy = R2 URL (File link untouched)
```

## Already in scrape-kit

Trigger task `save-media-to-r2` + profile pipeline (`skipR2: false`) do the same on Apify scrapes.

## social-hub (Inngest)

Event: `media/cdn.ready`

```bash
curl -X POST http://127.0.0.1:8787/demo/save-media \
  -H 'Content-Type: application/json' \
  -d '{"mediaRecordId":"recXXXXXXXX","force":true}'
```

Required env: `AIRTABLE_TOKEN`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_PUBLIC_BASE_URL`.
