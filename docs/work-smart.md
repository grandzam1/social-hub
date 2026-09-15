# Work smart (rate limits / credits)

We hit ScrapeCreators rate limits. **Do not** re-scrape the same handles/posts while debugging UI, normalize, Airtable, or R2.

## Rules

1. **Default `SC_MODE=cache`** — disk first; live only on miss.
2. **When limited: `SC_MODE=offline`** — fixtures/cache only; API calls throw.
3. **One live call → promote fixture** — never re-pay for the same payload.
4. **Prefer vendor cache** — `SC_VENDOR_CACHE_HOURS=168` (0 credits on vendor hit).
5. **Standalone helpers** — use `scripts/sc.mjs` / `npm run sc`, not ad-hoc curls in chat.
6. **UI/CSS/normalize/R2** — use saved JSON under `fixtures/scrapecreators/`; zero credits.

## Commands

```bash
cd ~/workspace/social-hub

# Stay offline
echo 'SC_MODE=offline' >> .env

# List saved dumps
npm run sc -- fixture list

# Replay without API (uses cache/fixture)
SC_MODE=offline npm run sc -- get /v1/twitter/user-tweets --handle Tesla

# Rare: one live fetch + save forever
SC_MODE=live SC_VENDOR_CACHE_HOURS=168 npm run sc -- get /v1/twitter/user-tweets --handle Tesla --save tesla-x-feed
```

## Layout

| Path | Purpose |
|------|---------|
| `.cache/scrapecreators/` | Auto cache (gitignored) |
| `fixtures/scrapecreators/` | Permanent dumps (commit these) |
| `scripts/sc.mjs` | CLI wrapper |
| `apps/api/src/lib/sc-cache.ts` | Same rules inside the API |

## What to test without scraping

- Thumb proxy / HEIC → JPEG
- Batch UI, dark theme, Zustand persist
- Normalize unit tests against fixtures
- R2 save-sync with existing Airtable media IDs
- Inngest retries with mock events
