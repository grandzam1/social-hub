import { createApp, type WorkerBindings } from "./app.js";

/**
 * Cloudflare Workers entry.
 * Secrets + vars from wrangler are copied into process.env so existing
 * Node-style libs keep working under nodejs_compat.
 */
export default {
  async fetch(
    request: Request,
    env: WorkerBindings,
    _ctx: ExecutionContext,
  ): Promise<Response> {
    for (const [key, value] of Object.entries(env)) {
      if (typeof value === "string") {
        process.env[key] = value;
      }
    }
    process.env.RUNTIME = "cloudflare";
    process.env.SC_MODE = process.env.SC_MODE || "live";
    process.env.SC_CACHE_WRITE = "0";
    process.env.INNGEST_DEV = process.env.INNGEST_DEV || "0";

    const app = createApp();
    return app.fetch(request, env);
  },
};
