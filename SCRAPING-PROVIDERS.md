# Scraping providers plan

Settings should manage scraping providers on the server. Today there is one ScrapeCreators key in the environment, and the Settings page only stores theme and autoplay in the browser.

Do this in two steps: ScrapeCreators key pool and failover first, then Apify as a second provider behind the same switch.

## 1. Current ScrapeCreators setup

Every live call goes through `scGet` in `apps/api/src/lib/scrapecreators.ts`. It sends `GET https://api.scrapecreators.com{path}` with the header `x-api-key`. The key is always `process.env.SCRAPECREATORS_API_KEY`. There is no second key, no retry, and no provider switch. A non-OK response throws immediately.

The app uses eight endpoints:

| Job | Endpoint | Called from |
|---|---|---|
| Instagram post | `/v1/instagram/post` | scrape, fresh media, avatar |
| TikTok video | `/v1/tiktok/video` | scrape, fresh media, avatar |
| X tweet | `/v1/twitter/tweet` | scrape, fresh media, avatar |
| X feed | `/v1/twitter/user-tweets` | recent posts |
| Instagram feed | `/v2/instagram/user/posts` | recent posts |
| TikTok feed | `/v3/tiktok/profile/videos` | recent posts |
| Balance | `/v1/account/credit-balance` | `/api/credits`, `/api/usage` |
| Usage log | `/v1/account/get-api-usage` | `/api/credits/history`, `/api/usage` |

Those raw JSON bodies are what the rest of the app understands. `normalizeInstagram`, `normalizeTikTok`, and `normalizeX` expect ScrapeCreators shapes (`xdt_shortcode_media`, `aweme_detail`, tweet `legacy` / media entities). Recent posts expects `tweets`, `items` + `next_max_id`, and `aweme_list` + `max_cursor`. Airtable stores `"Post scraper": "scrapecreators"` as a fixed string.

On Cloudflare, `SC_MODE` is `live` and the disk cache is off, so each scrape hits the vendor. Locally, `SC_MODE=cache` can replay `.cache/scrapecreators/` and `fixtures/scrapecreators/`.

## 2. Current API-key storage

One key, in two places:

- Local: `SCRAPECREATORS_API_KEY` in `.env`
- Production: the same name as a Wrangler secret, pushed by `scripts/cf-deploy-secrets.sh`

`apps/api/src/worker.ts` copies that secret into `process.env` on each request. `/health` only reports `hasScrapeCreators: true/false`.

The Settings page (`apps/web/src/pages/settings.tsx`) cannot hold this. It writes theme and autoplay to `localStorage` through `apps/web/src/lib/prefs.ts`. The API has no settings routes. The only authorized route in the app is `POST /internal/library-cache/bust`. Scrape, credits, and scraps are open.

## 3. Every place ScrapeCreators is called

Product code, all through `scrapecreators.ts`:

- `apps/api/src/lib/scrape-post.ts` — paste a post URL (`POST /api/scrape-post`)
- `apps/api/src/lib/save-media.ts` — re-scrape when a CDN file URL has expired
- `apps/api/src/lib/profile-avatar.ts` — re-scrape one existing post to get an avatar
- `apps/api/src/lib/recent-posts.ts` — `GET /api/recent-posts`
- `apps/api/src/app.ts` — `/api/credits`, `/api/credits/history`, `/api/usage`, `/health`

Scripts that call the API directly, outside the app: `scripts/sc.mjs`, `scripts/e2e-battle.mjs`, `scripts/dump-ig-raw.mjs`, `scripts/dump-x-raw.mjs`, `scripts/dump-x-retweet.mjs`. Leave those on the env key.

Trigger.dev and the save-media workflow do not call ScrapeCreators. The Apify mention in `docs/media-r2-pipeline.md` is a leftover note from scrape-kit. This repo has no Apify client.

## 4. Best way to store multiple keys

Store the key list in a **new Cloudflare KV namespace**, encrypted with one Wrangler secret, `SETTINGS_ENCRYPTION_KEY`. Keep using the existing `SCRAPECREATORS_API_KEY` only as a bootstrap key when KV has no keys yet.

One KV record, `settings:providers`, is enough:

- Provider order: `scrapecreators`, then `apify` if fallback is on
- Per key: `id`, `name`, `provider`, `enabled`, `preferred`, `last4`, `status`, `cooldownUntil`, `lastSuccessAt`, `lastError`, `lastCheckedAt`
- The secret itself: AES-GCM ciphertext only

The Settings API returns name, last 4 characters, enabled, preferred, and status. It accepts the full key only on create or replace, and never sends it back.

KV fits this project. The app already uses KV for the library cache (`LIBRARY_KV`). Do not put secrets in that namespace: `/internal/library-cache/bust` deletes library data, and a 60-second cache TTL must not apply to keys. Use a separate binding, `SETTINGS_KV`.

Airtable is the wrong store. It holds posts, media, profiles, and optional usage events, and anyone with base access could read the keys. Browser storage is also wrong: the Worker never sees `localStorage`, and the key would sit in the browser.

Adding `SCRAPECREATORS_API_KEY_2` as another Wrangler secret would stay hidden, but you would still edit secrets and redeploy to add a key. That misses the Settings requirement.

## 5. Best failover design

Put failover inside `scGet` only. Scrape, recent posts, avatar, and fresh-media download already call it, so those files stay as they are.

For one scrape request:

1. Load enabled ScrapeCreators keys that are not in cooldown. Try the preferred key first, then the others.
2. On success, set `status=ok` and `lastSuccessAt`, and clear the cooldown.
3. On a **key** failure, mark that key and try the next one in the same request.
4. If every ScrapeCreators key fails and Apify fallback is on, try Apify once.
5. Return one error only when every available key and the fallback provider have failed.

Treat these as key failures:

- `401` / `403`, or an invalid-key body → `rejected`. Leave it disabled until you turn it back on or replace it.
- Out of credits / `402` → `limited`. Cooldown for hours. A successful Test can clear it.
- `429` → `rate_limited`. Cooldown for about 15 minutes.
- `5xx` or a network timeout → `unavailable`. Cooldown for about 2 minutes.

Do not switch keys when the URL is bad, the post is missing, or the platform is unsupported. Those are content errors. Switching would burn the next key on the same bad link.

Balance and usage stay on the preferred key. They are account calls, not scrapes. The usage page should show each key’s balance by name, still without the secret. Test should call `/v1/account/credit-balance` for that key only, not scrape a post.

Skip a key while `cooldownUntil` is in the future, including on later requests. Otherwise a limited key gets hammered on every scrape.

## 6. How to add Apify

Add Apify as a second provider behind the same `scGet` decision, not as a parallel scrape path.

Settings would store:

- One or more Apify tokens, same encrypted KV record (name, enable, preferred, test)
- Active provider: ScrapeCreators or Apify
- Fallback on/off

When ScrapeCreators is active, the order is: preferred ScrapeCreators key → other healthy ScrapeCreators keys → Apify. If Apify is the active provider, try Apify first and use ScrapeCreators only when fallback is on.

Call existing Store Actors with `POST https://api.apify.com/v2/acts/{actor}/runs?waitForFinish=…` and then read the dataset. One token is the normal case. Extra tokens use the same pool as the ScrapeCreators keys.

Actors that cover what this app actually calls:

| Platform | Post and feed | Actor |
|---|---|---|
| Instagram | both | `apify/instagram-scraper` |
| TikTok | both | `clockworks/tiktok-scraper` |
| X | both | `apidojo/tweet-scraper` |

Test an Apify token with `GET https://api.apify.com/v2/users/me`. Usage for the Settings/usage screen is `GET /v2/users/me/usage/monthly`, in USD, not ScrapeCreators credits.

Apify output does not match the current normalizers. A small adapter has to map Actor fields into the objects `normalizeInstagram`, `normalizeTikTok`, `normalizeX`, and `listRecentPosts` already accept. Feeds also change: Apify takes `resultsLimit` / `maxItems` and does not return `next_max_id` or `max_cursor`, so “load more” has to raise the limit and drop duplicates.

When a scrape succeeds through Apify, write `"Post scraper": "apify"` on that post. The field already exists; it is hardcoded to `scrapecreators` today.

## 7. Can Apify replace ScrapeCreators?

It can cover the six scrape jobs, after adapters. It is not a drop-in replacement.

What lines up: Instagram post and carousel file URLs, TikTok direct CDN video URL, X text plus mp4 variants, and profile feeds for all three.

What does not: response JSON, cursor pagination, credit balance, and the usage log. X sometimes only has an HLS playlist instead of one mp4. TikTok and X file URLs expire quickly, which this app already handles by downloading to R2. Apify runs are slower (often tens of seconds per post) and billed per result, not per ScrapeCreators credit.

Keep both. Use ScrapeCreators as the default until each platform’s adapter has been checked against a real post. Then you can flip the active provider in Settings without another code change.

## 8. Files and database changes

No Airtable schema change. No new table.

New:

- `apps/api/src/lib/provider-keys.ts` — encrypt, save, list, pick the next key, set cooldown
- Settings routes on the API: list, add, enable, prefer, test, delete
- Later: `apps/api/src/lib/apify.ts` plus adapters into the existing normalizers

Edit:

- `apps/api/src/lib/scrapecreators.ts` — `scGet` tries the key pool and classifies errors
- `apps/api/src/app.ts` — settings routes; `/health` reports “has a usable key” instead of only the env var
- `apps/api/src/worker.ts` and `apps/api/wrangler.jsonc` — bind `SETTINGS_KV`
- `apps/web/src/pages/settings.tsx` — keys, preferred, enable, test, active provider, fallback
- `.env.example` and `scripts/cf-deploy-secrets.sh` — add `SETTINGS_ENCRYPTION_KEY` only

Leave `SCRAPECREATORS_API_KEY` in place until Settings has a working key.

Build ScrapeCreators keys and failover first. Add the Apify adapter after that, behind the same switch.

## 9. Security and reliability

The API is open. A Settings route that can write keys, with no admin check, would let anyone who can reach the Worker replace or test your keys. Gate those routes the same way library-cache bust is gated (`authorization` header), with a separate admin secret. Do not reuse `LIBRARY_BUST_SECRET`.

Other limits:

- KV is not in local Node (`apps/api/src/index.ts`). Local runs keep using `SCRAPECREATORS_API_KEY` until you use Wrangler, which has the KV binding.
- Encrypt before `put`. A KV read in the dashboard must not show the raw key.
- Log key id and status, never the key or the ciphertext.
- Cloudflare isolates can overlap. Two requests can pick the same key before either writes a cooldown. That is acceptable if cooldown is written immediately after a key failure.
- A content error must not burn the next key.
- Credit snapshots in `usage.ts` are for one balance. With several keys, snapshot the preferred key, or the usage page will mix accounts.
- Apify fallback on every ScrapeCreators failure would add a slow paid run. Only fall through when every enabled ScrapeCreators key has failed for that request.
