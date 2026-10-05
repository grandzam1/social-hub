import { z } from "zod";

export const variableName = z
  .string()
  .regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "illegal characters");

export type EnvPair = { name: string; value: string };

export type PreviewRow = EnvPair & {
  status: "New" | "Will overwrite" | "Invalid";
  reason: string;
};

const LINE =
  /(?:^|^)\s*(?:export\s+)?([\w.-]+)(?:\s*=\s*?|:\s+?)(\s*'(?:\\'|[^'])*'|\s*"(?:\\"|[^"])*"|\s*`(?:\\`|[^`])*`|[^#\r\n]+)?\s*(?:#.*)?(?:$|$)/;

/** Same line rules as dotenv's parse. The dotenv package pulls Node's os, path, and crypto, so it does not bundle in the browser. */
export function parseEnvLines(src: string): EnvPair[] {
  const rows: EnvPair[] = [];
  for (const rawLine of src.replace(/\r\n?/g, "\n").split("\n")) {
    const match = LINE.exec(rawLine);
    if (!match) continue;
    const name = match[1];
    let value = (match[2] || "").trim();
    const quote = value[0];
    value = value.replace(/^(['"`])([\s\S]*)\1$/, "$2");
    if (quote === '"') {
      value = value.replace(/\\n/g, "\n").replace(/\\r/g, "\r");
    }
    rows.push({ name, value });
  }
  return rows;
}

export function parseBulk(text: string): { error: string } | { pairs: EnvPair[] } {
  const trimmed = text.trim();
  if (!trimmed) return { pairs: [] };
  if (trimmed.startsWith("{")) {
    let data: unknown;
    try {
      data = JSON.parse(trimmed);
    } catch {
      return { error: "Invalid JSON" };
    }
    if (data === null || typeof data !== "object" || Array.isArray(data)) {
      return { error: 'JSON must be a flat object like {"KEY":"value"}' };
    }
    const pairs: EnvPair[] = [];
    for (const [name, value] of Object.entries(data)) {
      if (value !== null && typeof value === "object") {
        return { error: "Nested objects or arrays are not allowed" };
      }
      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        pairs.push({ name, value: String(value) });
        continue;
      }
      return { error: "Values must be strings, numbers, or booleans" };
    }
    return { pairs };
  }
  return { pairs: parseEnvLines(trimmed) };
}

export function previewRows(pairs: EnvPair[], existing: Set<string>): PreviewRow[] {
  const seen = new Set<string>();
  return pairs.map((pair) => {
    let status: PreviewRow["status"] = existing.has(pair.name) ? "Will overwrite" : "New";
    let reason = "";
    if (!pair.name) {
      status = "Invalid";
      reason = "empty name";
    } else if (!variableName.safeParse(pair.name).success) {
      status = "Invalid";
      reason = "illegal characters";
    } else if (pair.name.toLowerCase() === "master_key") {
      status = "Invalid";
      reason = "reserved name";
    } else if (seen.has(pair.name)) {
      status = "Invalid";
      reason = "duplicate name in the paste";
    } else if (!pair.value) {
      status = "Invalid";
      reason = "empty value";
    }
    if (pair.name) seen.add(pair.name);
    return { ...pair, status, reason };
  });
}

export function formatEnv(rows: EnvPair[]): string {
  return [...rows]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(({ name, value }) => {
      if (value === "" || /[\s#"'\n\\]/.test(value)) {
        const escaped = value
          .replaceAll("\\", "\\\\")
          .replaceAll('"', '\\"')
          .replaceAll("\n", "\\n");
        return `${name}="${escaped}"`;
      }
      return `${name}=${value}`;
    })
    .join("\n");
}

export function maskValue(value: string): string {
  if (value.length <= 8) return "••••";
  return `${value.slice(0, 3)}...${value.slice(-4)}`;
}
