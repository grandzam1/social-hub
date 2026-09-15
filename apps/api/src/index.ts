import { config } from "dotenv";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { createApp } from "./app.js";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../..");
config({ path: resolve(root, ".env") });

const app = createApp();
const port = Number(process.env.PORT ?? 8787);

console.log(`social-hub api listening on http://127.0.0.1:${port}`);
console.log(`UI → http://127.0.0.1:${port}/`);
console.log(`Batch → http://127.0.0.1:${port}/batch`);
console.log(`Scraps → http://127.0.0.1:${port}/scraps`);
console.log(`API docs → http://127.0.0.1:${port}/docs/api`);

serve({ fetch: app.fetch, port, hostname: "127.0.0.1" });
