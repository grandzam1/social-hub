/** Shared API helpers for the admin web app. */

export type CreditsInfo = {
  remaining: number | null;
  charged?: number;
};

export async function fetchJson<T>(
  input: string,
  init?: RequestInit,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(input, init);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `${msg}. Is the API running on :8787? (npm run dev:api)`,
    );
  }

  let data: (T & { ok?: boolean; error?: string }) | null = null;
  try {
    data = (await res.json()) as T & { ok?: boolean; error?: string };
  } catch {
    throw new Error(
      `Bad response (${res.status}). Is the API running on :8787?`,
    );
  }

  if (!res.ok || data?.ok === false) {
    throw new Error(data?.error || `Request failed (${res.status})`);
  }

  return data as T;
}

export function fmtNumber(n: unknown): string {
  if (n == null || n === "" || Number.isNaN(Number(n))) return "—";
  return new Intl.NumberFormat().format(Number(n));
}

export function fmtWhen(iso?: string): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    return new Intl.DateTimeFormat(undefined, {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(d);
  } catch {
    return "—";
  }
}

export function hiResAvatar(url?: string): string | undefined {
  if (!url) return undefined;
  return url.replace("_normal.", "_400x400.");
}

export function displayHandle(user?: string): string {
  const h = String(user || "").replace(/^@+/, "").trim();
  return h || "unknown";
}
