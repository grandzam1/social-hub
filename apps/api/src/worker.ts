import { createApp, type WorkerBindings } from "./app.js";
import { setConnectionsEnv } from "./connections/runtime.js";
import { setLibraryKv, type LibraryKv } from "./lib/library-cache.js";

export { SaveMediaWorkflow } from "./workflows/save-media.js";

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
    setConnectionsEnv(env);
    setLibraryKv(
      env.LIBRARY_KV && typeof env.LIBRARY_KV === "object"
        ? (env.LIBRARY_KV as LibraryKv)
        : undefined,
    );

    const app = createApp();
    if (process.env.COUNT_FETCHES !== "1") {
      return app.fetch(request, env);
    }

    const baseFetch = globalThis.fetch.bind(globalThis);
    let total = 0;
    let supabase = 0;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      total += 1;
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      if (url.includes(".supabase.co/rest/")) supabase += 1;
      return baseFetch(input, init);
    }) as typeof fetch;
    try {
      return await app.fetch(request, env);
    } finally {
      globalThis.fetch = baseFetch;
      console.log(`[fetch-count] total=${total} supabase=${supabase}`);
    }
  },
};
