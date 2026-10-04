import { describe, expect, it } from "vitest";
import { createMemoryCatalog } from "./providers/memory.js";

describe("memory catalog", () => {
  it("upserts a post and its media, then lists and updates them", async () => {
    const catalog = createMemoryCatalog();
    const post = await catalog.upsertPost({
      "Post ID": "abc",
      Text: "hello",
      Platform: "instagram",
      Status: "Scraped",
    });
    const second = await catalog.upsertMedia({
      "Media ID": "abc_1",
      Post: [post.id],
      Order: 1,
      "File link": "https://cdn.example/1.jpg",
      "Saved copy": "https://r2.example/old.jpg",
    });
    const first = await catalog.upsertMedia({
      "Media ID": "abc_0",
      Post: [post.id],
      Order: 0,
      "File link": "https://cdn.example/0.jpg",
    });
    const kept = await catalog.upsertMedia({
      "Media ID": "abc_1",
      Post: [post.id],
      Order: 1,
      "File link": "https://cdn.example/1b.jpg",
    });

    expect(kept.id).toBe(second.id);
    expect(kept.fields["Saved copy"]).toBe("https://r2.example/old.jpg");
    expect(kept.fields["File link"]).toBe("https://cdn.example/1b.jpg");

    const updated = await catalog.updatePost(post.id, {
      Files: [second.id, first.id],
      Status: "Saving",
    });
    expect(updated.fields.Status).toBe("Saving");

    const media = await catalog.listMediaForPost(post.id);
    expect(media.map((row) => row.fields.Order)).toEqual([0, 1]);
    expect(media.map((row) => row.id)).toEqual([first.id, second.id]);

    const again = await catalog.upsertPost({
      "Post ID": "abc",
      Text: "updated",
    });
    expect(again.id).toBe(post.id);
    expect(again.fields.Text).toBe("updated");
    expect(again.fields.Status).toBe("Saving");
  });
});
