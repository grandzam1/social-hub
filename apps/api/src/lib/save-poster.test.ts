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
