#!/usr/bin/env node
const url = process.argv[2] || "https://www.instagram.com/reel/DdO9A2EAt8g/";
const res = await fetch("http://127.0.0.1:8787/api/scrape-post", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ url, saveToR2: true, saveMode: "sync" }),
});
const text = await res.text();
let j;
try {
  j = JSON.parse(text);
} catch {
  console.error(res.status, text.slice(0, 500));
  process.exit(1);
}
if (!j.ok) {
  console.error(res.status, j);
  process.exit(1);
}
console.log(
  JSON.stringify(
    {
      ok: j.ok,
      platform: j.platform,
      handle: j.profile.handle,
      postId: j.post.postId,
      status: j.post.status,
      media: (j.media || []).map((m) => ({
        id: m.id,
        type: m.type,
        status: m.fileStatus,
        hasSaved: Boolean(m.savedCopy),
        savedCopy: m.savedCopy?.slice(0, 80),
        bytes: m.save?.bytes,
      })),
      credits: j.creditsRemaining,
    },
    null,
    2,
  ),
);
