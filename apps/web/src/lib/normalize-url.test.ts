import assert from "node:assert/strict";
import test from "node:test";
import { detectPlatform, normalizeUrl } from "./normalize-url.ts";

test("extracts a link from a mobile share blurb and strips tracking", () => {
  const raw =
    "Check this reel https://www.instagram.com/reel/AbC123/?igsh=abc&utm_source=ig_web_copy_link";
  assert.equal(
    normalizeUrl(raw),
    "https://www.instagram.com/reel/AbC123/",
  );
  assert.equal(detectPlatform(normalizeUrl(raw)!), "instagram");
});

test("keeps TikTok and X mobile short hosts", () => {
  assert.equal(
    normalizeUrl("https://vt.tiktok.com/ZS123/?_r=1&_t=8"),
    "https://vt.tiktok.com/ZS123/",
  );
  assert.equal(detectPlatform("https://vt.tiktok.com/ZS123/"), "tiktok");
  assert.equal(detectPlatform("https://vm.tiktok.com/ZM123/"), "tiktok");
  assert.equal(detectPlatform("https://m.instagram.com/reel/AbC123/"), "instagram");
  assert.equal(
    detectPlatform("https://mobile.twitter.com/user/status/123"),
    "x",
  );
});

test("unwraps Instagram login and link-shim wrappers", () => {
  assert.equal(
    normalizeUrl(
      "https://www.instagram.com/accounts/login/?next=https%3A%2F%2Fwww.instagram.com%2Freel%2FAbC123%2F%3Figsh%3Dzzz",
    ),
    "https://www.instagram.com/reel/AbC123/",
  );
  assert.equal(
    normalizeUrl(
      "https://l.instagram.com/?u=https%3A%2F%2Fwww.instagram.com%2Fp%2FAbC123%2F",
    ),
    "https://www.instagram.com/p/AbC123/",
  );
});

test("returns null when the paste has no link", () => {
  assert.equal(normalizeUrl("just a username"), null);
  assert.equal(detectPlatform("https://example.com/post"), null);
});
