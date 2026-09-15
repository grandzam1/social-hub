import { inngest } from "./client.js";
import { saveMediaCdnToR2 } from "../lib/save-media.js";

/**
 * After scrape: CDN URL stays on File link.
 * Download best/original bytes → R2 → write Saved copy (our host).
 */
export const saveMediaToR2 = inngest.createFunction(
  {
    id: "save-media-to-r2",
    name: "Save media CDN → R2",
    retries: 3,
    // Parallel carousel slides (still capped to avoid CDN/R2 stampede)
    concurrency: [{ limit: 5 }],
  },
  { event: "media/cdn.ready" },
  async ({ event, step }) => {
    const data = event.data as {
      mediaRecordId: string;
      postRecordId?: string;
      fileUrl?: string;
      objectKey?: string;
      mediaType?: string;
      force?: boolean;
      order?: number;
    };

    if (!data.mediaRecordId) throw new Error("mediaRecordId required");

    // One step so retries re-run the whole save safely (idempotent via Saved copy unless force).
    return step.run("save-cdn-to-r2", async () => saveMediaCdnToR2(data));
  },
);

/** Smoke-test function — proves Inngest can run work. */
export const helloSocial = inngest.createFunction(
  { id: "hello-social", name: "Hello Social" },
  { event: "social/hello" },
  async ({ event, step }) => {
    const message = await step.run("build-message", async () => {
      return `Hello from Social Hub — ${event.data?.who ?? "world"}`;
    });

    await step.run("log-message", async () => {
      console.log("[hello-social]", message, event.data);
      return true;
    });

    return { ok: true, message };
  },
);

export const functions = [helloSocial, saveMediaToR2];
