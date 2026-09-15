#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Compile-free: duplicate quick check by importing via tsx
const raw = JSON.parse(
  readFileSync(resolve(import.meta.dirname, "last-x-raw.json"), "utf8"),
);

const { register } = await import("node:module");
const { pathToFileURL: p } = await import("node:url");

// Use dynamic import of built logic via spawning is heavy — inline minimal assert:
const legacy = raw.legacy || {};
const user = raw.core?.user_results?.result;
const media = legacy.extended_entities?.media || legacy.entities?.media || [];
console.log("raw-check", {
  screen: user?.core?.screen_name,
  likes: legacy.favorite_count,
  replies: legacy.reply_count,
  views: raw.views?.count,
  media: media.length,
  w: media[0]?.original_info?.width,
  h: media[0]?.original_info?.height,
});

const res = await fetch("http://127.0.0.1:8787/api/scrape-post", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    url: "https://x.com/elonmusk/status/2088037519312994480?s=20",
    saveToR2: false,
  }),
});
const j = await res.json();
console.log("api", {
  status: res.status,
  ok: j.ok,
  error: j.error,
  handle: j.profile?.handle,
  name: j.profile?.name,
  avatar: Boolean(j.profile?.avatar),
  likes: j.post?.likes,
  comments: j.post?.comments,
  views: j.post?.views,
  media: j.media?.length,
  media0: j.media?.[0],
});
