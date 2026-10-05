import { describe, expect, it } from "vitest";
import { libraryPreviewUrl } from "./scraps.js";

describe("libraryPreviewUrl", () => {
  it("uses the hosted poster for a saved video", () => {
    expect(
      libraryPreviewUrl(
        "video",
        "https://pub.example.r2.dev/video.mp4",
        "https://pub.example.r2.dev/poster.jpg",
      ),
    ).toBe("https://pub.example.r2.dev/poster.jpg");
  });

  it("omits the preview when a video has no hosted poster", () => {
    expect(
      libraryPreviewUrl("video", "https://pub.example.r2.dev/video.mp4", undefined),
    ).toBeUndefined();
  });

  it("keeps the saved image as its own preview", () => {
    expect(
      libraryPreviewUrl("image", "https://pub.example.r2.dev/photo.jpg", undefined),
    ).toBe("https://pub.example.r2.dev/photo.jpg");
  });
});
