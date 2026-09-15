#!/usr/bin/env node
/**
 * Shared .env loader for standalone scripts (WSL / Node).
 * Usage: import { loadEnv, root } from "./lib/load-env.mjs";
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

export function loadEnv(extraPaths = []) {
  const paths = [resolve(root, ".env"), resolve(root, "apps/api/.env"), ...extraPaths];
  for (const envPath of paths) {
    if (!existsSync(envPath)) continue;
    for (const line of readFileSync(envPath, "utf8").split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#") || !t.includes("=")) continue;
      const i = t.indexOf("=");
      const k = t.slice(0, i).trim();
      const v = t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
      if (!process.env[k]) process.env[k] = v;
    }
  }
}
