import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const envPath = resolve(process.cwd(), "../../.env");
const parsed = Object.fromEntries(
  readFileSync(envPath, "utf8")
    .split(/\r?\n/)
    .filter((line) => line && !line.trim().startsWith("#") && line.includes("="))
    .map((line) => {
      const index = line.indexOf("=");
      return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
    }),
);

const secret = parsed.TRIGGER_SECRET_KEY;
if (!secret) {
  console.error("TRIGGER_SECRET_KEY missing from .env");
  process.exit(1);
}

const child = spawn("npx", ["wrangler", "secret", "put", "TRIGGER_SECRET_KEY"], {
  stdio: ["pipe", "inherit", "inherit"],
  shell: true,
});
child.stdin.end(secret);
child.on("exit", (code) => process.exit(code ?? 1));
