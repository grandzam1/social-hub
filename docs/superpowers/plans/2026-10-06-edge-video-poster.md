# Edge video poster Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every saved video shows a JPEG we host before playback, so Edge Mobile does not have to decode the first frame to paint the card.

**Architecture:** At scrape time, ask Apify to store the TikTok cover, then copy that image to R2 next to the video. The library returns that hosted URL as `previewUrl`. Both players set it as `poster` with `preload="metadata"` and `playsInline`. Do not declare a codec string on the `<source>` tag. Do not set `crossOrigin` on the video, because the R2 host does not send `Access-Control-Allow-Origin` and a cross-origin mode would block playback.

**Tech Stack:** Hono on Cloudflare Workers, R2, React video elements, Vitest.

## Global Constraints

- A poster URL returned to the browser is an R2 URL. A TikTok CDN URL is never a `poster`.
- Leave the MP4 bytes unchanged when the file is already H.264 (`avc1`) plus AAC (`mp4a`) with `moov` before `mdat`.
- Do not add `codecs="avc1.42E01E, mp4a.40.2"` unless the sample entry actually is that profile. A wrong profile makes Edge skip the file.
- `preload` stays `metadata`. There is no service worker to version.

## What was measured

Saved TikTok `7242449293112577323` on R2, 3,216,955 bytes:

- `Content-Type: video/mp4`
- `Accept-Ranges: bytes`, and `Range: bytes=0-1` returns `206` with `Content-Range: bytes 0-1/3216955`
- Top-level boxes: `ftyp`, `moov`, `free`, `mdat` (index is at the front)
- Sample codecs in `moov`: `avc1` and `mp4a`
- Library item `previewUrl` is empty
- Catalog cover host is `p16-common-sign.tiktokcdn-eu.com`, and there is no `Saved poster`

The library player in `apps/web/src/pages/scraps.tsx` already sets `playsInline` and `preload="metadata"`. It does not set `poster`. `apps/api/src/lib/scraps.ts` sets `previewUrl` only when `kind === "image"`.

---

### Task 1: Store the cover on R2

**Files:**
- Modify: `apps/api/src/platforms/providers/apify.ts` (`postInput` TikTok branch)
- Modify: `apps/api/src/lib/save-media.ts` (`saveMediaCdnToR2`)
- Modify: `apps/api/src/lib/scrape-post.ts` (return the hosted poster)
- Test: `apps/api/src/lib/save-poster.test.ts`

**Interfaces:**
- Consumes: media field `Preview link` (source cover URL) and `transferCdnToR2`
- Produces: media field `Saved poster` (R2 image URL). `saveMediaCdnToR2` result gains `posterUrl?: string`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/lib/save-poster.test.ts`. Mock `transferCdnToR2` is not required if the helper is pure. Test the URL choice:

```ts
import { describe, expect, it } from "vitest";
import { posterSourceUrl } from "./save-poster.js";

describe("posterSourceUrl", () => {
  it("prefers an Apify-hosted cover over a TikTok CDN cover", () => {
    expect(
      posterSourceUrl({
        apifyCover: "https://api.apify.com/v2/key-value-stores/s/records/cover.jpg",
        cdnCover: "https://p16-common-sign.tiktokcdn-eu.com/cover.jpg",
      }),
    ).toBe("https://api.apify.com/v2/key-value-stores/s/records/cover.jpg");
  });

  it("uses the CDN cover when Apify did not store one", () => {
    expect(
      posterSourceUrl({
        cdnCover: "https://p16-common-sign.tiktokcdn-eu.com/cover.jpg",
      }),
    ).toBe("https://p16-common-sign.tiktokcdn-eu.com/cover.jpg");
  });

  it("returns empty when neither cover exists", () => {
    expect(posterSourceUrl({})).toBe("");
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run src/lib/save-poster.test.ts` from `apps/api`.

Expected: FAIL, `posterSourceUrl` is not defined.

- [ ] **Step 3: Implement the helper and the save**

`apps/api/src/lib/save-poster.ts`:

```ts
export function posterSourceUrl(input: {
  apifyCover?: string;
  cdnCover?: string;
}): string {
  const apify = input.apifyCover?.trim() || "";
  if (apify.includes("api.apify.com")) return apify;
  return input.cdnCover?.trim() || "";
}
```

In `normalizeApifyTikTok`, keep the current cover fields. When `videoMeta.coverUrl` or `raw.coverUrl` contains `api.apify.com`, that value is the Apify cover. Pass both into `posterSourceUrl` and store the winner on `NormalizedScrape.cover` and on the media `previewUrl`.

In `postInput` for TikTok, set `shouldDownloadCovers: true` next to `shouldDownloadVideos: true`.

In `saveMediaCdnToR2`, after the video upload succeeds and `media.fields.Type === "video"`:

- Read `Preview link`.
- If it is non-empty and not already `isHostedMediaUrl`, call `transferCdnToR2` with `mediaType: "image"` and a distinct object key (`${mediaRecordId}-poster`).
- Write `{ "Saved poster": uploaded.publicUrl }` on the media row.
- If the cover download fails, leave `Saved poster` empty and still keep the video `saved`. Do not fail the video save because the poster failed.

Return `posterUrl` on the save result. In `scrape-post.ts`, copy that onto `mediaOut[].previewLink` only when it is the hosted URL.

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/lib/save-poster.test.ts` from `apps/api`.

Expected: PASS.

### Task 2: Send the hosted poster to the library

**Files:**
- Modify: `apps/api/src/lib/scraps.ts` (the `items.push` in the media loop, around the `previewUrl` line)
- Test: `apps/api/src/lib/scraps.test.ts` if a library mapping test already exists; otherwise add the assertion beside the existing scraps tests. Search `listScraps` tests first and extend that file.

**Interfaces:**
- Consumes: media field `Saved poster`
- Produces: `ScrapItem.previewUrl` for videos. Images keep using `savedCopy`.

- [ ] **Step 1: Write the failing assertion**

A video row with `saveStatus: "saved"`, `Saved copy` set, and `Saved poster` set must produce `previewUrl` equal to `Saved poster`. A video row with no `Saved poster` must produce `previewUrl` undefined. An image row must still use `savedCopy`.

- [ ] **Step 2: Run it and confirm the video case fails**

Current code sets `previewUrl` only for images, so the video assertion fails.

- [ ] **Step 3: Map the field**

```ts
const savedPoster = asStr(f["Saved poster"]);
const previewUrl = kind === "image" ? savedCopy : savedPoster;
```

Use `previewUrl` in the `items.push` object. Do not fall back to `Preview link`.

- [ ] **Step 4: Run the scraps test**

Expected: PASS.

### Task 3: Paint the poster in both players

**Files:**
- Modify: `apps/web/src/pages/scraps.tsx` (`MediaSlide` video, around line 364)
- Modify: `apps/web/src/pages/pull.tsx` (video around line 232)
- Modify: `apps/web/src/hooks/use-media-autoplay.ts`

**Interfaces:**
- Consumes: `ScrapItem.previewUrl` and the scrape result's hosted `previewLink`
- Produces: a `<video poster>` when that URL is non-empty

- [ ] **Step 1: Library player**

On the video in `MediaSlide`:

```tsx
<video
  className="max-h-full max-w-full bg-black object-contain"
  {...(watch ? {} : { "data-media-video": "" })}
  data-force-controls="1"
  playsInline
  muted={watch ? undefined : true}
  preload="metadata"
  controls
  poster={item.previewUrl || undefined}
  src={src}
/>
```

- [ ] **Step 2: Pull player**

Use `poster` only when `m.previewLink` is an `https` URL on our R2 host or already saved. If the only URL is `tiktokcdn`, omit `poster`. Keep `playsInline` and set `preload="metadata"`.

- [ ] **Step 3: Autoplay failure**

In `use-media-autoplay.ts`, when `video.play()` rejects, set `video.controls = true` and leave the element paused. Edge then still shows the poster and a play control.

- [ ] **Step 4: Check the feed in a browser**

Open the saved scraps feed. A video card shows the JPEG before play. Pressing play starts the same MP4. The pull result for a new scrape shows the hosted poster, not a TikTok CDN image.

### Task 4: Backfill the Selena video

**Files:** none. One production save of the existing cover, after Task 1 is deployed.

- [ ] **Step 1: Deploy the poster save.**

- [ ] **Step 2: Re-save the existing TikTok media row** with `POST /api/media/save-sync` and `force: true` so the cover is copied while the signed TikTok URL still works. If that URL returns 403, scrape the post once more so Apify stores a fresh cover, then save.

- [ ] **Step 3: Confirm `GET /api/scraps?user=selenagomez` returns `kind: "video"`, `saveStatus: "saved"`, and a `previewUrl` whose host is the R2 public host.
