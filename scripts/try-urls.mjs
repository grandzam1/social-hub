#!/usr/bin/env node
const args = process.argv.slice(2);
const saveToR2 = !args.includes("--no-r2");
const urls = args.filter((a) => !a.startsWith("--"));

for (const url of urls) {
  console.log("\n=== TRY:", url, "saveToR2=", saveToR2, "===");
  const t0 = Date.now();
  try {
    const res = await fetch("http://127.0.0.1:8787/api/scrape-post", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, saveToR2, saveMode: "sync" }),
    });
    const text = await res.text();
    let j;
    try {
      j = JSON.parse(text);
    } catch {
      console.log({ http: res.status, ms: Date.now() - t0, body: text.slice(0, 400) });
      continue;
    }
    if (!j.ok) {
      console.log({ http: res.status, ms: Date.now() - t0, ok: false, error: j.error });
      continue;
    }
    console.log({
      http: res.status,
      ms: Date.now() - t0,
      ok: true,
      platform: j.platform,
      handle: j.profile?.handle,
      name: j.profile?.name,
      postId: j.post?.postId,
      status: j.post?.status,
      caption: (j.post?.text || "").slice(0, 120),
      mediaCount: j.media?.length ?? 0,
      media: (j.media || []).map((m) => ({
        type: m.type,
        fileStatus: m.fileStatus,
        hasSaved: Boolean(m.savedCopy),
        file: (m.fileLink || "").slice(0, 90),
        bytes: m.save?.bytes,
      })),
      creditsRemaining: j.creditsRemaining,
    });
  } catch (e) {
    console.log({ ms: Date.now() - t0, crash: String(e.message || e) });
  }
}
