# Social Hub module map

Social Hub is two apps that already match two deployables: a Hono API in `apps/api` and a React admin in `apps/web`. The API keeps almost every feature in one flat `src/lib` folder, and `apps/api/public` is a second, vanilla copy of Pull, Batch, and Scraps. Split by feature inside those apps. Give Instagram, TikTok, and X their own adapters so a platform bug stays in that platform.

Left out of this map: `backups/`, `fixtures/`, `scripts/`, `docs/`, `node_modules`, `apps/api/public/vendor`, and `apps/api/public/admin` (the built admin bundle). The design-system files under `apps/web/src/components/ui/` can stay where they are. `sidebar.tsx` is 703 lines and still one job.

Line counts are from the repo source on 5 Oct 2026.

## Domains and the files in each

**HTTP shell.** Boots Node (`index.ts`) and Cloudflare (`worker.ts`). `app.ts` (810 lines) registers every route and also serves the legacy HTML and JS.

**Platforms.** `scrapecreators.ts` calls ScrapeCreators for all three networks and also fetches credit balance. `sc-cache.ts` switches live, cache, and offline. `normalize.ts` (529 lines) turns raw JSON into `NormalizedScrape`. `types.ts` holds that shape. `packages/shared/src/index.ts` repeats a smaller version of the same types, and the web app declares `Platform` again in `batch-store.ts`.

**Pull a post.** `scrape-post.ts` (344 lines) detects the platform, normalizes, saves the avatar, upserts profile, post, and media, then saves to R2 sync or async. The form is `pages/pull.tsx`. `lib/caption.ts` formats the caption. The old page is `public/index.html`.

**Batch feed.** `recent-posts.ts` (399 lines) fetches a profile and maps Instagram, TikTok, and X again, separate from `normalize.ts`. The page is `pages/batch.tsx` (603 lines), which both parses a handle and renders the list. Selection lives in `lib/batch-store.ts`. The old copy is `public/batch.js` (816), `batch.html`, and `batch-store.js`.

**Scraps library.** `scraps.ts` builds the gallery from Airtable. `library-cache.ts` caches it. `pages/scraps.tsx` (1,290 lines) groups posts, draws cards and the carousel, and implements download and share. `use-media-autoplay.ts` and `expandable-text.tsx` belong here too. The old copy is `public/scraps.js` (1,162) and `scraps.html`.

**Media save.** `r2.ts` (434 lines) is the S3 client, the CDN download, content-type sniffing, and object keys. `save-media.ts` downloads one file or every unsaved slide and writes Airtable. `queue-media-save.ts` enqueues work. `save-status.ts` and `post-status.ts` are the status fields. `profile-avatar.ts` stores avatars. The job that actually runs is `trigger/save-media-to-r2.ts`. `workflows/save-media.ts` is a separate Cloudflare workflow for the same download-and-upload idea.

**Airtable.** `airtable.ts` (340 lines) is the HTTP client with retries, plus list and upsert for posts, media, and profiles.

**Credits and usage.** `usage.ts` records Airtable requests, R2 bytes, and credit snapshots. Credit balance and history are functions inside `scrapecreators.ts`. The screen is `pages/usage.tsx` and `credits-chip.tsx`. The old widget is `public/credits.js`.

**Admin shell.** `App.tsx` routes Pull, Batch, Scraps, Usage, Settings, and Docs. Layout is `admin-layout.tsx`, `app-sidebar.tsx`, and `site-header.tsx`. Theme is `theme-provider.tsx`, `theme-toggle.tsx`, `pages/settings.tsx`, and `lib/prefs.ts`. `lib/api.ts` is the shared fetch helper. `pages/docs.tsx` is the in-app docs page.

## Files that are too big or mixed

| File | Lines | What is mixed |
| --- | ---: | --- |
| `apps/api/public/ui.css` | 2,773 | One stylesheet for the whole legacy UI |
| `apps/web/src/pages/scraps.tsx` | 1,290 | Types, grouping, carousel, card, download, and share |
| `apps/api/public/scraps.js` | 1,162 | The same gallery, second implementation |
| `apps/api/public/batch.js` | 816 | The same batch screen, second implementation |
| `apps/api/src/app.ts` | 810 | Health, scrape, media, thumbs, avatars, credits, usage, scraps, cache bust, and static files |
| `apps/web/src/pages/batch.tsx` | 603 | Handle parser and the page |
| `apps/api/src/lib/normalize.ts` | 529 | Instagram, TikTok, and X |
| `apps/api/src/lib/r2.ts` | 434 | Storage client, CDN fetch, sniffing, and key names |
| `apps/api/src/lib/recent-posts.ts` | 399 | A second set of platform mappers, plus the feed query |
| `apps/api/src/lib/scrape-post.ts` | 344 | Scrape, avatar, three upserts, and the save decision |
| `apps/api/src/lib/airtable.ts` | 340 | HTTP client and three tables |
| `apps/api/src/lib/save-media.ts` | 336 | One-file save, unsaved batch, and failure writes |

## Folder structure

```text
social-hub/
  apps/
    api/src/
      http/
        app.ts                  mounts routers only
        worker.ts
        index.ts
        routes/
          health.ts
          scrape.ts             POST /api/scrape-post
          media.ts              save, save-sync, save-unsaved, download, thumb
          scraps.ts
          recent-posts.ts
          credits.ts
          usage.ts
          assets.ts             legacy HTML/JS only
      platforms/
        detect.ts
        instagram/  client.ts  normalize.ts  feed.ts
        tiktok/     client.ts  normalize.ts  feed.ts
        x/          client.ts  normalize.ts  feed.ts
        cache.ts
      scrape/
        pipeline.ts             one URL to Airtable rows
      catalog/
        client.ts               auth, retry
        posts.ts
        media.ts
        profiles.ts
      media/
        r2.ts                   upload, copy, delete
        detect-kind.ts
        download-cdn.ts
        save.ts
        queue.ts
        status.ts
        avatar.ts
      library/
        scraps.ts
        cache.ts
      usage/
        events.ts
        credits.ts
      jobs/
        trigger/save-media-to-r2.ts
        workflows/save-media.ts
    web/src/
      app/                      App.tsx, layout, sidebar, theme
      features/
        pull/                   page, caption
        batch/                  page, parse-handle, store
        scraps/                 page, card, carousel, save-to-device
        usage/                  page, credits chip
        settings/
        docs/
      components/ui/            leave as-is
      lib/api.ts
  packages/shared/              Platform and the API response types, one copy
```

`apps/api/public` stays the legacy UI until it is retired. New gallery and batch work goes in `apps/web`.

## What you can fix on its own

A wrong X quote or retweet is `platforms/x`. Pull and Batch keep receiving the same `NormalizedScrape`. Instagram and TikTok files stay closed.

A bad handle parse or a selection bug is `features/batch` in the web app. The profile fetch stays in `platforms/*/feed.ts`.

A carousel, card, or phone-download bug is `features/scraps`. The list the API returns stays in `library/scraps.ts`.

A bad R2 key or content type is `media/r2.ts` and `media/detect-kind.ts`. The Airtable write stays in `media/save.ts`. The Trigger.dev retry stays in `jobs/trigger`.

An Airtable 429 is `catalog/client.ts`. A Posts field rename is `catalog/posts.ts`.

A wrong credit number is `usage/credits.ts` plus the usage page. The scrape pipeline only records an event. It does not own the balance screen.

A route or static-file bug is `http/`. `assets.ts` is the only place that knows about `public/scraps.js`. The React scraps page does not.
