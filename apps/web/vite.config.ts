import path from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const root = path.dirname(fileURLToPath(import.meta.url));

// Production deploy mounts the SPA under /admin/ on the same Worker as the API.
// Default the production build to that path so Windows deploys (where a
// `VITE_BASE=...` npm-script prefix is ignored) still emit /admin/assets/*.
function resolveBase(command: "build" | "serve"): string {
  const fromEnv = process.env.VITE_BASE?.trim();
  if (fromEnv) return fromEnv;
  return command === "build" ? "/admin/" : "/";
}

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  base: resolveBase(command),
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(root, "./src"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8787",
        changeOrigin: true,
      },
      "/health": {
        target: "http://127.0.0.1:8787",
        changeOrigin: true,
      },
      "/docs": {
        target: "http://127.0.0.1:8787",
        changeOrigin: true,
      },
    },
  },
}));
