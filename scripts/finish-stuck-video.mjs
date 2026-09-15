#!/usr/bin/env node
/**
 * Finish the stuck Elon video: re-scrape with practical quality + async R2.
 */
const url =
  process.argv[2] ||
  "https://x.com/elonmusk/status/2087822520128823438?s=20";

const t0 = Date.now();
const res = await fetch("http://127.0.0.1:8787/api/scrape-post", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    url,
    saveToR2: true,
    saveMode: "async",
    force: true,
  }),
});
const j = await res.json();
console.log(
  JSON.stringify(
    {
      http: res.status,
      ms: Date.now() - t0,
      ok: j.ok,
      error: j.error,
      saveMode: j.saveMode,
      status: j.post?.status,
      handle: j.profile?.handle,
      media: (j.media || []).map((m) => ({
        id: m.id,
        order: m.order,
        type: m.type,
        fileStatus: m.fileStatus,
        file: (m.fileLink || "").slice(0, 100),
        hasSaved: Boolean(m.savedCopy),
      })),
    },
    null,
    2,
  ),
);
