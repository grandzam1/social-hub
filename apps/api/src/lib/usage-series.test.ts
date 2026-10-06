import { describe, expect, it } from "vitest";
import {
  mergeUsageReading,
  summarizeUsageSeries,
  type UsageEvent,
} from "./usage.js";

function event(
  partial: Partial<UsageEvent> & Pick<UsageEvent, "service" | "metric" | "delta" | "unit">,
): UsageEvent {
  return {
    id: partial.id ?? partial.metric,
    path: partial.path,
    method: partial.method,
    status: partial.status,
    detail: partial.detail,
    at: partial.at ?? "2026-10-05T00:00:00.000Z",
    ...partial,
  };
}

describe("summarizeUsageSeries", () => {
  it("rolls any service and unit into given, used, and remaining", () => {
    const series = summarizeUsageSeries([
      event({
        service: "r2",
        metric: "upload_bytes",
        delta: 1500,
        unit: "bytes",
        at: "2026-10-01T00:00:00.000Z",
      }),
      event({
        service: "r2",
        metric: "upload_bytes",
        delta: 500,
        unit: "bytes",
        at: "2026-10-02T00:00:00.000Z",
      }),
      event({
        service: "r2",
        metric: "allowance",
        delta: 10_000,
        unit: "bytes",
        at: "2026-10-01T00:00:00.000Z",
      }),
      event({
        service: "custom-billing",
        metric: "api_request",
        delta: 4,
        unit: "count",
      }),
      event({
        service: "scrapecreators",
        metric: "credit_snapshot",
        delta: 12,
        unit: "credits",
        at: "2026-10-04T00:00:00.000Z",
      }),
      event({
        service: "scrapecreators",
        metric: "credit_snapshot",
        delta: 3,
        unit: "credits",
        at: "2026-10-05T00:00:00.000Z",
      }),
    ]);

    const r2 = series.find((row) => row.service === "r2");
    expect(r2).toMatchObject({
      unit: "bytes",
      used: 2000,
      given: 10_000,
      remaining: 8000,
    });

    const custom = series.find((row) => row.service === "custom-billing");
    expect(custom).toMatchObject({
      unit: "count",
      used: 4,
      given: null,
      remaining: null,
    });

    const credits = series.find((row) => row.service === "scrapecreators");
    expect(credits?.remaining).toBe(3);
  });
});

describe("mergeUsageReading", () => {
  it("fills a provider balance onto the matching series", () => {
    const ledger = summarizeUsageSeries([
      event({
        service: "scrapecreators",
        metric: "credit_snapshot",
        delta: 9,
        unit: "credits",
      }),
    ]);
    const merged = mergeUsageReading(ledger, {
      service: "scrapecreators",
      unit: "credits",
      metric: "balance",
      used: 48,
      remaining: 0,
      source: "live",
    });
    expect(merged).toEqual([
      expect.objectContaining({
        service: "scrapecreators",
        given: 48,
        used: 48,
        remaining: 0,
        source: "live",
      }),
    ]);
  });
});
