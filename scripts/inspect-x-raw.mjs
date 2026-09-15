#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const j = JSON.parse(
  readFileSync(resolve(import.meta.dirname, "last-x-raw.json"), "utf8"),
);
const l = j.legacy || {};
const user = j.core?.user_results?.result;
const media =
  l.extended_entities?.media || l.entities?.media || [];

function walk(obj, path = "", out = []) {
  if (!obj || typeof obj !== "object") return out;
  for (const [k, v] of Object.entries(obj)) {
    const p = path ? `${path}.${k}` : k;
    if (
      typeof v === "string" &&
      (v.includes("video.twimg.com") ||
        v.includes("pbs.twimg.com/media") ||
        v.includes(".mp4"))
    ) {
      out.push([p, v.slice(0, 100)]);
    }
    if (k === "media" && Array.isArray(v)) out.push([p, `array(${v.length})`]);
    if (typeof v === "object" && path.split(".").length < 8) walk(v, p, out);
  }
  return out;
}

console.log(
  JSON.stringify(
    {
      rest_id: j.rest_id,
      full_text: l.full_text,
      screen: user?.core?.screen_name,
      name: user?.core?.name,
      mediaCount: media.length,
      mediaTypes: media.map((m) => m.type),
      cardKeys: j.card ? Object.keys(j.card) : [],
      hasQuoted: Boolean(j.quoted_status_result),
      hasRetweet: Boolean(l.retweeted_status_result),
      topKeys: Object.keys(j),
      urlHits: walk(j).slice(0, 30),
    },
    null,
    2,
  ),
);
