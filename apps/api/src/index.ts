import { config } from "dotenv";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync, existsSync } from "node:fs";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../..");
config({ path: resolve(root, ".env") });

const { serve } = await import("@hono/node-server");
const { Hono } = await import("hono");
const { serve: serveInngest } = await import("inngest/hono");
const { inngest } = await import("./inngest/client.js");
const { functions } = await import("./inngest/functions.js");
const { saveMediaCdnToR2 } = await import("./lib/save-media.js");
const { scrapePostPipeline } = await import("./lib/scrape-post.js");
const { listScraps } = await import("./lib/scraps.js");
const { listRecentPosts } = await import("./lib/recent-posts.js");
const {
  getCreditBalance,
  getCreditUsage,
} = await import("./lib/scrapecreators.js");

const app = new Hono();
const publicDir = resolve(fileURLToPath(new URL(".", import.meta.url)), "../public");

app.get("/health", (c) =>
  c.json({
    ok: true,
    service: "social-hub-api",
    inngestDev: process.env.INNGEST_DEV === "1",
    hasEventKey: Boolean(process.env.INNGEST_EVENT_KEY),
    hasSigningKey: Boolean(process.env.INNGEST_SIGNING_KEY),
    hasAirtable: Boolean(
      process.env.AIRTABLE_TOKEN || process.env.AIRTABLE_API_KEY,
    ),
    hasR2: Boolean(
      process.env.R2_ACCOUNT_ID &&
        process.env.R2_ACCESS_KEY_ID &&
        process.env.R2_SECRET_ACCESS_KEY,
    ),
    hasScrapeCreators: Boolean(process.env.SCRAPECREATORS_API_KEY),
  }),
);

app.on(
  ["GET", "PUT", "POST"],
  "/api/inngest",
  serveInngest({ client: inngest, functions }),
);

app.post("/demo/hello", async (c) => {
  try {
    const body = await c.req.json().catch(() => ({} as { who?: string }));
    const ids = await inngest.send({
      name: "social/hello",
      data: { who: body.who ?? "WSL", at: new Date().toISOString() },
    });
    return c.json({ ok: true, ids });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[demo/hello]", message);
    return c.json({ ok: false, error: message }, 500);
  }
});

type SaveMediaBody = {
  mediaRecordId?: string;
  postRecordId?: string;
  fileUrl?: string;
  objectKey?: string;
  mediaType?: string;
  force?: boolean;
};

/** Async queue (needs Inngest Dev or Cloud). */
app.post("/api/media/save", async (c) => {
  try {
    const body = (await c.req.json()) as SaveMediaBody;
    if (!body?.mediaRecordId) {
      return c.json({ ok: false, error: "mediaRecordId required" }, 400);
    }
    const ids = await inngest.send({
      name: "media/cdn.ready",
      data: {
        mediaRecordId: body.mediaRecordId,
        postRecordId: body.postRecordId,
        fileUrl: body.fileUrl,
        objectKey: body.objectKey,
        mediaType: body.mediaType,
        force: Boolean(body.force),
      },
    });
    return c.json({
      ok: true,
      mode: "async",
      event: "media/cdn.ready",
      ids,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[api/media/save]", message);
    return c.json({ ok: false, error: message }, 500);
  }
});

/**
 * Standalone sync — no Inngest required.
 * Runs download → R2 → Airtable in this request.
 */
app.post("/api/media/save-sync", async (c) => {
  try {
    const body = (await c.req.json()) as SaveMediaBody;
    if (!body?.mediaRecordId) {
      return c.json({ ok: false, error: "mediaRecordId required" }, 400);
    }
    const result = await saveMediaCdnToR2({
      mediaRecordId: body.mediaRecordId,
      postRecordId: body.postRecordId,
      fileUrl: body.fileUrl,
      objectKey: body.objectKey,
      mediaType: body.mediaType,
      force: Boolean(body.force),
    });
    return c.json({ ok: true, mode: "sync", result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[api/media/save-sync]", message);
    return c.json({ ok: false, error: message }, 500);
  }
});

/**
 * Paste a post URL → ScrapeCreators → Airtable → optional R2.
 */
app.post("/api/scrape-post", async (c) => {
  try {
    const body = (await c.req.json()) as {
      url?: string;
      saveToR2?: boolean;
      saveMode?: "sync" | "async";
      force?: boolean;
    };
    if (!body?.url) {
      return c.json({ ok: false, error: "url required" }, 400);
    }
    const result = await scrapePostPipeline({
      url: body.url,
      saveToR2: body.saveToR2,
      saveMode: body.saveMode,
      force: body.force,
    });
    return c.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[api/scrape-post]", message);
    return c.json({ ok: false, error: message }, 500);
  }
});

/** ScrapeCreators credit balance + recent charge history. */
app.get("/api/credits", async (c) => {
  try {
    const remaining = await getCreditBalance();
    return c.json({ ok: true, remaining });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[api/credits]", message);
    return c.json({ ok: false, error: message }, 500);
  }
});

app.get("/api/credits/history", async (c) => {
  try {
    const page = Number(c.req.query("page") || "1") || 1;
    const [remaining, history] = await Promise.all([
      getCreditBalance(),
      getCreditUsage(page),
    ]);
    return c.json({ ok: true, remaining, page, history });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[api/credits/history]", message);
    return c.json({ ok: false, error: message }, 500);
  }
});

/** List recent posts for a handle — fetch only, no R2 / Airtable. */
app.get("/api/recent-posts", async (c) => {
  try {
    const platform = (c.req.query("platform") || "").toLowerCase();
    const handle = c.req.query("handle") || "";
    const limit = Number(c.req.query("limit") || "24") || 24;
    const cursor = c.req.query("cursor") || undefined;
    const filter = c.req.query("filter") || "media";
    if (!["x", "instagram", "tiktok"].includes(platform)) {
      return c.json(
        { ok: false, error: "platform must be x, instagram, or tiktok" },
        400,
      );
    }
    if (!handle.trim()) {
      return c.json({ ok: false, error: "handle required" }, 400);
    }
    const result = await listRecentPosts({
      platform: platform as "x" | "instagram" | "tiktok",
      handle,
      limit,
      cursor,
      filter,
    });
    return c.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[api/recent-posts]", message);
    return c.json({ ok: false, error: message }, 500);
  }
});

/** Proxy CDN thumbnails so browser privacy blockers don't blank the feed. */
/** TikTok often serves .heic covers — browsers can't paint those in <img>. */
function thumbCandidateUrls(raw: string): string[] {
  const out: string[] = [];
  const push = (u: string) => {
    if (u && !out.includes(u)) out.push(u);
  };
  push(raw);
  const lower = raw.toLowerCase();
  if (lower.includes(".heic")) {
    push(raw.replace(/\.heic\b/gi, ".jpeg"));
    push(raw.replace(/\.heic\b/gi, ".jpg"));
    push(raw.replace(/\.heic\b/gi, ".webp"));
    push(raw.replace(/:q\d+\.heic\b/gi, ":q70.jpeg"));
    push(raw.replace(/~tplv-[^/?#]+/gi, (m) => m.replace(/\.heic\b/gi, ".jpeg")));
  }
  return out;
}

function isAllowedThumbHost(host: string): boolean {
  const h = host.toLowerCase();
  return (
    h === "pbs.twimg.com" ||
    h === "video.twimg.com" ||
    h.endsWith(".twimg.com") ||
    h.endsWith(".cdninstagram.com") ||
    h.endsWith(".instagram.com") ||
    h.includes("tiktokcdn") ||
    h.includes("tiktokv.") ||
    h.includes("byteoversea") ||
    h.includes("ibyteimg") ||
    h.includes("muscdn") ||
    h.includes("tiktok.com")
  );
}

app.get("/api/thumb", async (c) => {
  try {
    const rawUrl = c.req.query("url") || "";
    if (!rawUrl) return c.text("url required", 400);
    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
    } catch {
      return c.text("invalid url", 400);
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return c.text("invalid protocol", 400);
    }
    if (!isAllowedThumbHost(parsed.hostname)) {
      return c.text("host not allowed", 403);
    }

    const headers = {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
      Referer: "https://www.tiktok.com/",
    };

    let lastStatus = 0;
    for (const candidate of thumbCandidateUrls(parsed.toString())) {
      let candUrl: URL;
      try {
        candUrl = new URL(candidate);
      } catch {
        continue;
      }
      if (!isAllowedThumbHost(candUrl.hostname)) continue;

      const upstream = await fetch(candUrl.toString(), { headers });
      lastStatus = upstream.status;
      if (!upstream.ok) continue;

      let contentType =
        upstream.headers.get("content-type") || "image/jpeg";
      // Skip HEIC/HEIF — Chrome/Firefox <img> can't decode them
      if (/heic|heif/i.test(contentType) || /\.heic(\?|$)/i.test(candUrl.pathname)) {
        continue;
      }
      if (!contentType.startsWith("image/")) continue;

      const buf = await upstream.arrayBuffer();
      if (!buf.byteLength) continue;
      c.header("Content-Type", contentType);
      c.header("Cache-Control", "public, max-age=86400");
      return c.body(buf);
    }

    return c.text(`no browser-safe thumb (last ${lastStatus || "n/a"})`, 502);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[api/thumb]", message);
    return c.text("thumb failed", 500);
  }
});

/** Saved Scraps library — Posts + Media from Airtable. */
app.get("/api/scraps", async (c) => {
  try {
    const type = c.req.query("type") || "all";
    const user = c.req.query("user") || "";
    const q = c.req.query("q") || "";
    const result = await listScraps({ type, user, q });
    return c.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[api/scraps]", message);
    return c.json({ ok: false, error: message }, 500);
  }
});

/** @deprecated use /api/media/save */
app.post("/demo/save-media", async (c) => {
  try {
    const body = (await c.req.json()) as SaveMediaBody;
    if (!body?.mediaRecordId) {
      return c.json({ ok: false, error: "mediaRecordId required" }, 400);
    }
    const ids = await inngest.send({
      name: "media/cdn.ready",
      data: {
        mediaRecordId: body.mediaRecordId,
        postRecordId: body.postRecordId,
        fileUrl: body.fileUrl,
        objectKey: body.objectKey,
        mediaType: body.mediaType,
        force: Boolean(body.force),
      },
    });
    return c.json({ ok: true, ids, event: "media/cdn.ready" });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[demo/save-media]", message);
    return c.json({ ok: false, error: message }, 500);
  }
});

function sendPublic(c: { header: (k: string, v: string) => void }, name: string, type: string) {
  const path = resolve(publicDir, name);
  if (!existsSync(path)) return null;
  c.header("Content-Type", type);
  return readFileSync(path, "utf8");
}

app.get("/", (c) => {
  const html = sendPublic(c, "index.html", "text/html; charset=utf-8");
  if (!html) return c.text("UI missing", 404);
  return c.body(html);
});

app.get("/scraps", (c) => {
  const html = sendPublic(c, "scraps.html", "text/html; charset=utf-8");
  if (!html) return c.text("UI missing", 404);
  return c.body(html);
});

app.get("/batch", (c) => {
  const html = sendPublic(c, "batch.html", "text/html; charset=utf-8");
  if (!html) return c.text("UI missing", 404);
  return c.body(html);
});

app.get("/docs/api.md", (c) => {
  const path = resolve(root, "docs/api.md");
  if (!existsSync(path)) return c.text("API docs missing", 404);
  c.header("Content-Type", "text/markdown; charset=utf-8");
  return c.body(readFileSync(path, "utf8"));
});

app.get("/docs/api", (c) => {
  const html = sendPublic(c, "api-docs.html", "text/html; charset=utf-8");
  if (!html) return c.text("API docs UI missing", 404);
  return c.body(html);
});

app.get("/ui.css", (c) => {
  const css = sendPublic(c, "ui.css", "text/css; charset=utf-8");
  if (!css) return c.text("missing", 404);
  return c.body(css);
});

app.get("/ui.js", (c) => {
  const js = sendPublic(c, "ui.js", "application/javascript; charset=utf-8");
  if (!js) return c.text("missing", 404);
  return c.body(js);
});

app.get("/scraps.js", (c) => {
  const js = sendPublic(c, "scraps.js", "application/javascript; charset=utf-8");
  if (!js) return c.text("missing", 404);
  return c.body(js);
});

app.get("/theme.js", (c) => {
  const js = sendPublic(c, "theme.js", "application/javascript; charset=utf-8");
  if (!js) return c.text("missing", 404);
  return c.body(js);
});

app.get("/credits.js", (c) => {
  const js = sendPublic(c, "credits.js", "application/javascript; charset=utf-8");
  if (!js) return c.text("missing", 404);
  return c.body(js);
});

app.get("/batch.js", (c) => {
  const js = sendPublic(c, "batch.js", "application/javascript; charset=utf-8");
  if (!js) return c.text("missing", 404);
  return c.body(js);
});

app.get("/batch-store.js", (c) => {
  const js = sendPublic(c, "batch-store.js", "application/javascript; charset=utf-8");
  if (!js) return c.text("missing", 404);
  return c.body(js);
});

app.get("/vendor/zustand/:file", (c) => {
  const file = c.req.param("file");
  if (!file || file.includes("..") || file.includes("/")) {
    return c.text("not found", 404);
  }
  const path = resolve(publicDir, "vendor/zustand", file);
  if (!existsSync(path)) return c.text("missing", 404);
  const body = readFileSync(path, "utf8");
  c.header("Content-Type", "application/javascript; charset=utf-8");
  c.header("Cache-Control", "public, max-age=86400");
  return c.body(body);
});

const port = Number(process.env.PORT ?? 8787);
console.log(`social-hub api listening on http://127.0.0.1:${port}`);
console.log(`UI → http://127.0.0.1:${port}/`);
console.log(`Batch → http://127.0.0.1:${port}/batch`);
console.log(`Scraps → http://127.0.0.1:${port}/scraps`);
console.log(`API docs → http://127.0.0.1:${port}/docs/api`);
serve({ fetch: app.fetch, port, hostname: "127.0.0.1" });
