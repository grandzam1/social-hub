import { readFileSync } from "node:fs";

const API = process.env.API_URL || "https://social-hub.kelvinchristian144.workers.dev";
const res = await fetch(`${API}/api/scraps?type=all`);
const data = await res.json();
console.log("api ok", data.ok, "items", data.items?.length);

const map = new Map();
for (const item of data.items || []) {
  const key = item.postRecordId || item.id;
  if (!map.has(key)) map.set(key, { media: 0, kinds: new Set(), user: item.user });
  const g = map.get(key);
  if (item.kind === "image" || item.kind === "video") {
    g.media++;
    g.kinds.add(item.kind);
  }
}
const posts = [...map.values()];
console.log(
  "posts",
  posts.length,
  "multi-media",
  posts.filter((p) => p.media > 1).length,
);
console.log(
  "sample",
  posts.slice(0, 4).map((p) => ({
    user: p.user,
    media: p.media,
    kinds: [...p.kinds],
  })),
);
const js = readFileSync(
  new URL("../apps/api/public/scraps.js", import.meta.url),
  "utf8",
);
const css = readFileSync(
  new URL("../apps/api/public/ui.css", import.meta.url),
  "utf8",
);
console.log("has groupPosts", js.includes("function groupPosts"));
console.log("has post-card css", css.includes(".post-card"));
console.log("has mosaic", css.includes('data-layout="mosaic"') || css.includes("[data-layout=\"mosaic\"]"));
