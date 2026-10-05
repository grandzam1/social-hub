import type { Platform } from "../lib/types.js";
import type { ScrapeProvider } from "./types.js";

const TEN_MINUTES_MS = 10 * 60 * 1000;
const ONE_MINUTE_MS = 60 * 1000;

export type ProviderResultStatus = "ok" | "402" | "401" | "429" | "error";

export type ProviderLastResult = {
  status: ProviderResultStatus;
  at: string;
};

type FailureInfo = {
  fallback: boolean;
  reason: string;
  cooldownMs: number;
  status: ProviderResultStatus;
};

const skipUntil = new Map<string, number>();
const lastResults = new Map<string, ProviderLastResult>();
const lastCredits = new Map<string, number | null>();

let nowFn = () => Date.now();

export function setScrapeClock(fn: () => number) {
  nowFn = fn;
}

export function resetScrapeFallbackState() {
  skipUntil.clear();
  lastResults.clear();
  lastCredits.clear();
  nowFn = () => Date.now();
}

export function providerLastResult(name: string): ProviderLastResult | null {
  return lastResults.get(name) ?? null;
}

export function providerLastCredits(name: string): number | null | undefined {
  return lastCredits.has(name) ? lastCredits.get(name) : undefined;
}

export function providerCoolingDown(name: string): boolean {
  const until = skipUntil.get(name);
  if (until == null) return false;
  if (until <= nowFn()) {
    skipUntil.delete(name);
    return false;
  }
  return true;
}

function redact(text: string): string {
  return text
    .replace(/sb_secret_[A-Za-z0-9_-]+/g, "[redacted]")
    .replace(/sb_publishable_[A-Za-z0-9_-]+/g, "[redacted]")
    .replace(/\bsk_[A-Za-z0-9_-]+\b/g, "[redacted]")
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(
      /(api[_-]?key|token|secret|authorization)(["']?\s*[:=]\s*)\S+/gi,
      "$1$2[redacted]",
    );
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function httpStatus(message: string): number | undefined {
  const matches = [...message.matchAll(/\b([45]\d{2})\b/g)];
  const status = matches.map((match) => Number(match[1])).find((code) => code >= 400);
  return status;
}

function isNetwork(err: unknown, message: string): boolean {
  const name = err instanceof Error ? err.name : "";
  if (name === "AbortError" || name === "TimeoutError") return true;
  return /timeout|timed out|network|fetch failed|ECONN|ENOTFOUND|EAI_AGAIN|socket/i.test(
    message,
  );
}

function isContentError(message: string): boolean {
  return /post not found|not found|private|deleted|no items/i.test(message);
}

function isMissingKey(message: string): boolean {
  return /Missing connection|Missing env var|missing key|API key is not set/i.test(
    message,
  );
}

export function classifyScrapeFailure(err: unknown): FailureInfo {
  const message = messageOf(err);
  const status = httpStatus(message);
  if (isMissingKey(message)) {
    const reason = /sk_|api[_-]?key\s*[:=]|bearer\s+\S+|secret\s*[:=]/i.test(message)
      ? "missing key"
      : redact(message).slice(0, 200);
    return { fallback: true, reason, cooldownMs: TEN_MINUTES_MS, status: "401" };
  }
  if (isContentError(message) && status !== 401 && status !== 402 && status !== 429 && !(status && status >= 500)) {
    return { fallback: false, reason: redact(message).slice(0, 200), cooldownMs: 0, status: "error" };
  }
  if (
    status === 401 ||
    status === 402 ||
    status === 403 ||
    status === 429 ||
    (status != null && status >= 500)
  ) {
    const resultStatus: ProviderResultStatus =
      status === 401 || status === 402 || status === 429 ? String(status) as ProviderResultStatus : "error";
    const cooldownMs =
      status === 429 ? ONE_MINUTE_MS : status === 401 || status === 402 ? TEN_MINUTES_MS : 0;
    return {
      fallback: true,
      reason: `HTTP ${status}`,
      cooldownMs,
      status: resultStatus,
    };
  }
  if (isNetwork(err, message)) {
    return { fallback: true, reason: "network error", cooldownMs: 0, status: "error" };
  }
  return {
    fallback: false,
    reason: redact(message).slice(0, 200),
    cooldownMs: 0,
    status: "error",
  };
}

function remember(name: string, status: ProviderResultStatus) {
  lastResults.set(name, { status, at: new Date(nowFn()).toISOString() });
}

function stamp<T>(value: T, providerUsed: string, fallbackUsed: boolean): T {
  if (value && typeof value === "object") {
    Object.assign(value, { providerUsed, fallbackUsed });
  }
  return value;
}

/**
 * Tries providers in order. Each attempt is that provider's own call:
 * one extra outbound fetch per fallback step, and none while a provider is cooling down.
 */
export function createFallbackProvider(
  providers: ScrapeProvider[],
  options: { autoSwitch: boolean },
): ScrapeProvider {
  const chain = options.autoSwitch ? providers : providers.slice(0, 1);

  async function run<T>(call: (provider: ScrapeProvider) => Promise<T>): Promise<T> {
    const failures: string[] = [];
    for (const provider of chain) {
      if (options.autoSwitch && providerCoolingDown(provider.name)) {
        failures.push(`${provider.name}: skipped during cooldown`);
        continue;
      }
      try {
        const result = await call(provider);
        remember(provider.name, "ok");
        return stamp(result, provider.name, provider !== providers[0]);
      } catch (err) {
        const info = classifyScrapeFailure(err);
        remember(provider.name, info.status);
        if (!info.fallback || !options.autoSwitch) throw err;
        if (info.cooldownMs > 0) {
          skipUntil.set(provider.name, nowFn() + info.cooldownMs);
        }
        failures.push(`${provider.name}: ${info.reason}`);
      }
    }
    throw new Error(`All scrape providers failed: ${failures.join("; ")}`);
  }

  return {
    name: providers.map((provider) => provider.name).join(","),
    fetchPost(url) {
      return run((provider) => provider.fetchPost(url));
    },
    fetchFeed(handle, platform: Platform, cursor) {
      return run((provider) => provider.fetchFeed(handle, platform, cursor));
    },
    async getCredits() {
      const listed: Array<{ name: string; remaining: number | null }> = [];
      let remaining: number | null = null;
      for (let index = 0; index < providers.length; index += 1) {
        const provider = providers[index]!;
        if (!provider.getCredits) {
          listed.push({ name: provider.name, remaining: null });
          continue;
        }
        try {
          const credits = await provider.getCredits();
          listed.push({ name: provider.name, remaining: credits.remaining });
          lastCredits.set(provider.name, credits.remaining);
          if (index === 0) remaining = credits.remaining;
        } catch (err) {
          const info = classifyScrapeFailure(err);
          remember(provider.name, info.status);
          if (info.cooldownMs > 0) {
            skipUntil.set(provider.name, nowFn() + info.cooldownMs);
          }
          listed.push({ name: provider.name, remaining: null });
          lastCredits.set(provider.name, null);
        }
      }
      return { remaining, providers: listed };
    },
  };
}

export async function probeScrapeProvider(provider: ScrapeProvider): Promise<{
  status: ProviderResultStatus;
  at: string;
  remaining: number | null;
  message: string;
}> {
  if (!provider.getCredits) {
    remember(provider.name, "error");
    const last = providerLastResult(provider.name)!;
    return { status: "error", at: last.at, remaining: null, message: "credits are not available" };
  }
  try {
    const credits = await provider.getCredits();
    remember(provider.name, "ok");
    lastCredits.set(provider.name, credits.remaining);
    const last = providerLastResult(provider.name)!;
    return {
      status: "ok",
      at: last.at,
      remaining: credits.remaining,
      message: "ok",
    };
  } catch (err) {
    const info = classifyScrapeFailure(err);
    remember(provider.name, info.status);
    if (info.cooldownMs > 0) skipUntil.set(provider.name, nowFn() + info.cooldownMs);
    lastCredits.set(provider.name, null);
    const last = providerLastResult(provider.name)!;
    return {
      status: info.status,
      at: last.at,
      remaining: null,
      message: info.reason,
    };
  }
}
