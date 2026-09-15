# Carousel / multi-media posts

Social Hub models carousels as a **1 Post → many Media** relationship.

## Schema (already in Airtable)

| Table | Field | Role |
|-------|--------|------|
| **Posts** | `Files` | Link to many **Media** rows (same as “Media Records”) |
| **Posts** | `Media count` | Number of slides (kept in sync by API) |
| **Posts** | `Status` | `Scraped` → `Saving` → `Saved` (only when **all** slides ready) |
| **Media** | `Post` | Link back to parent post |
| **Media** | `Order` | **0, 1, 2…** exact carousel sequence |
| **Media** | `Type` | `image` / `video` / `gif` |
| **Media** | `File link` | Platform CDN |
| **Media** | `Saved copy` | R2 permanent URL |
| **Media** | `File status` | Per-slide: `File link ready` → `Saved copy ready` |

## Three rules (implemented)

1. **Explicit `Order`** — never rely on Airtable link order; UI/API sort by `Order`.
2. **Per-item save status** — one failed slide does not mark the post `Saved`.
3. **Batch R2 via Inngest** — when `media.length > 1`, scrape queues all `media/cdn.ready` events in one `inngest.send([...])` (concurrency 5).

## Save mode auto-pick

| Media count | Default |
|-------------|---------|
| 0 | none |
| 1 | `sync` (wait in HTTP request) |
| 2+ (carousel) | `async` (Inngest batch) |

Override with `saveMode: "sync" | "async"` on `POST /api/scrape-post`.

## Flow

```text
scrape post
  → upsert Profile + Post (Status=Saving|Scraped)
  → upsert Media rows (Order 0..n-1, File link=CDN)
  → link Post.Files = [mediaIds…]
  → if carousel: batch Inngest media/cdn.ready
  → each job: CDN → R2 → File status=Saved copy ready
  → refreshPostSaveStatus: Saved only if every child is ready
```
