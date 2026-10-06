/**
 * Append-only usage events (Airtable table).
 * Writes never throw to callers — soft-fail if table unset or Airtable errors.
 * Does not invent vendor quotas/limits.
 */

import { connectionsEnv } from "../connections/runtime.js";
import type { ConnectionsDb } from "../connections/index.js";
import { getAppSecret } from "../connections/secrets.js";

/** Any name you pass to recordUsageEvent. Known callers use the values below. */
export type UsageService = string;
export type UsageMetric = string;
export type UsageUnit = string;

export type UsageEventInput = {
  service: UsageService;
  metric: UsageMetric;
  delta: number;
  unit: UsageUnit;
  path?: string;
  method?: string;
  status?: number;
  detail?: string;
};

export type UsageEvent = UsageEventInput & {
  id: string;
  at: string;
};

async function usageTableId(): Promise<string | null> {
  const id = (await getAppSecret(connectionsEnv(), "airtable_usage_events_table"))?.trim();
  return id || null;
}

async function baseId() {
  return (await getAppSecret(connectionsEnv(), "airtable_base_id"))?.trim() || "appkPrLfwDGwIIbTL";
}

async function token(): Promise<string | null> {
  return (await getAppSecret(connectionsEnv(), "airtable_token"))?.trim() || null;
}

async function isUsageTablePath(path: string): Promise<boolean> {
  const table = await usageTableId();
  if (!table) return false;
  return path.includes(`/${table}`);
}

/** True when path targets the usage_events table (skip re-entrant tracking). */
export async function shouldSkipAirtableUsageTracking(path: string): Promise<boolean> {
  return isUsageTablePath(path);
}

const USAGE_BATCH_SIZE = 10;
/** Quiet period before a short remainder is sent. Full groups of 10 go immediately. */
const USAGE_BATCH_DELAY_MS = 1500;

let usageQueue: Record<string, unknown>[] = [];
let usageTimer: ReturnType<typeof setTimeout> | undefined;

async function supabaseConfigured(): Promise<boolean> {
  if (supabaseUsageTableMissing) return false;
  const env = connectionsEnv();
  const url = (await getAppSecret(env, "supabase_url"))?.trim();
  const key = (await getAppSecret(env, "supabase_secret_key"))?.trim();
  return Boolean(url && key);
}

let supabaseUsageTableMissing = false;

function noteSupabaseUsageError(status: number, body: string): boolean {
  if (status === 404 && body.includes("PGRST205")) {
    supabaseUsageTableMissing = true;
    return true;
  }
  return false;
}

async function supabaseAuth(): Promise<{ url: string; key: string } | null> {
  const env = connectionsEnv();
  const url = (await getAppSecret(env, "supabase_url"))?.trim().replace(/\/+$/, "");
  const key = (await getAppSecret(env, "supabase_secret_key"))?.trim();
  if (!url || !key) return null;
  return { url, key };
}

async function writeSupabaseUsage(
  records: Record<string, unknown>[],
): Promise<void> {
  const auth = await supabaseAuth();
  if (!auth || !records.length) return;
  const rows = records.map((fields) => ({
    service: fields.Service,
    metric: fields.Metric,
    delta: fields.Delta,
    unit: fields.Unit,
    path: fields.Path ?? null,
    method: fields.Method ?? null,
    status_code: fields["Status Code"] ?? null,
    detail: fields.Detail ?? null,
    occurred_at: fields["Occurred At"],
  }));
  const res = await fetch(`${auth.url}/rest/v1/usage_events`, {
    method: "POST",
    headers: {
      apikey: auth.key,
      Authorization: `Bearer ${auth.key}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify(rows),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    if (noteSupabaseUsageError(res.status, body)) return;
    console.warn(
      `[usage] supabase write failed ${res.status}: ${body.slice(0, 200)}`,
    );
  }
}

const USAGE_EVENTS_TABLE = `create table if not exists usage_events (
  id text primary key,
  service text not null,
  metric text not null,
  delta real not null,
  unit text not null,
  path text,
  method text,
  status_code integer,
  detail text,
  occurred_at text not null
)`;

async function ensureD1Usage(db: ConnectionsDb): Promise<void> {
  await db.prepare(USAGE_EVENTS_TABLE).run();
  await db
    .prepare(
      `create index if not exists usage_events_occurred_at on usage_events (occurred_at desc)`,
    )
    .run();
}

async function writeD1Usage(
  db: ConnectionsDb,
  records: Record<string, unknown>[],
): Promise<void> {
  await ensureD1Usage(db);
  const statements = records.map((fields) => {
    const bytes = crypto.getRandomValues(new Uint8Array(7));
    const id = `rec${[...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
    return db
      .prepare(
        `insert into usage_events (
          id, service, metric, delta, unit, path, method, status_code, detail, occurred_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        fields.Service ?? "",
        fields.Metric ?? "",
        fields.Delta ?? 0,
        fields.Unit ?? "count",
        fields.Path ?? null,
        fields.Method ?? null,
        fields["Status Code"] ?? null,
        fields.Detail ?? null,
        fields["Occurred At"] ?? new Date().toISOString(),
      );
  });
  await db.batch(statements);
}

async function listD1Usage(
  db: ConnectionsDb,
  pageSize: number,
): Promise<UsageEvent[]> {
  await ensureD1Usage(db);
  const limit = Math.min(500, Math.max(1, pageSize));
  const result = await db
    .prepare(
      `select id, service, metric, delta, unit, path, method, status_code, detail, occurred_at
       from usage_events
       order by occurred_at desc
       limit ?`,
    )
    .bind(limit)
    .all<{
      id: string;
      service: string;
      metric: string;
      delta: number;
      unit: string;
      path: string | null;
      method: string | null;
      status_code: number | null;
      detail: string | null;
      occurred_at: string;
    }>();
  return (result.results ?? []).map((row) => ({
    id: row.id,
    service: row.service,
    metric: row.metric,
    delta: row.delta,
    unit: row.unit,
    path: row.path ?? undefined,
    method: row.method ?? undefined,
    status: row.status_code ?? undefined,
    detail: row.detail ?? undefined,
    at: row.occurred_at,
  }));
}

async function writeUsageBatch(
  records: Record<string, unknown>[],
): Promise<void> {
  if (!records.length) return;
  if (await supabaseConfigured()) {
    await writeSupabaseUsage(records);
    if (!supabaseUsageTableMissing) return;
  }
  const db = connectionsEnv().DB;
  if (db) {
    await writeD1Usage(db, records);
    return;
  }
  const table = await usageTableId();
  const auth = await token();
  if (!table || !auth) return;

  const url = `https://api.airtable.com/v0/${await baseId()}/${table}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${auth}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      records: records.map((fields) => ({ fields })),
      typecast: true,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.warn(
      `[usage] write failed ${res.status}: ${body.slice(0, 200)}`,
    );
  }
}

function sendUsageBatch(records: Record<string, unknown>[]) {
  void writeUsageBatch(records).catch((err) => {
    console.warn("[usage] write error", err instanceof Error ? err.message : err);
  });
}

function flushUsageQueue() {
  usageTimer = undefined;
  while (usageQueue.length) {
    sendUsageBatch(usageQueue.splice(0, USAGE_BATCH_SIZE));
  }
}

function enqueueUsageRecord(fields: Record<string, unknown>) {
  usageQueue.push(fields);
  while (usageQueue.length >= USAGE_BATCH_SIZE) {
    sendUsageBatch(usageQueue.splice(0, USAGE_BATCH_SIZE));
  }
  if (usageTimer) clearTimeout(usageTimer);
  if (!usageQueue.length) {
    usageTimer = undefined;
    return;
  }
  usageTimer = setTimeout(flushUsageQueue, USAGE_BATCH_DELAY_MS);
}

/** Fire-and-forget append. Safe to call from hot paths. */
export function recordUsageEvent(input: UsageEventInput): void {
  void recordUsageEventAsync(input);
}

async function recordUsageEventAsync(input: UsageEventInput): Promise<void> {
  if (!(await usageTrackingConfigured())) return;
  if (!Number.isFinite(input.delta)) return;

  const fields: Record<string, unknown> = {
    Label: `${input.service}:${input.metric}`,
    Service: input.service,
    Metric: input.metric,
    Delta: input.delta,
    Unit: input.unit,
    "Occurred At": new Date().toISOString(),
  };
  if (input.path) fields.Path = input.path.slice(0, 500);
  if (input.method) fields.Method = input.method;
  if (input.status != null && Number.isFinite(input.status)) {
    fields["Status Code"] = input.status;
  }
  if (input.detail) fields.Detail = input.detail.slice(0, 1000);

  enqueueUsageRecord(fields);
}

export function recordAirtableRequest(opts: {
  method: string;
  path: string;
  status: number;
}): void {
  void recordAirtableRequestAsync(opts);
}

async function recordAirtableRequestAsync(opts: {
  method: string;
  path: string;
  status: number;
}): Promise<void> {
  if (await shouldSkipAirtableUsageTracking(opts.path)) return;
  recordUsageEvent({
    service: "airtable",
    metric: "api_request",
    delta: 1,
    unit: "count",
    method: opts.method,
    path: opts.path.split("?")[0],
    status: opts.status,
  });
}

export function recordR2Upload(opts: { bytes: number; key?: string }): void {
  if (!opts.bytes || opts.bytes < 0) return;
  recordUsageEvent({
    service: "r2",
    metric: "upload_bytes",
    delta: opts.bytes,
    unit: "bytes",
    detail: opts.key,
  });
}

/** Optional snapshot — ScrapeCreators remains source of truth for balance. */
let lastCreditSnapshotAt = 0;
let lastCreditSnapshotValue: number | null = null;

export function recordScrapeCreatorsCreditSnapshot(remaining: number): void {
  if (!Number.isFinite(remaining)) return;
  const now = Date.now();
  // Avoid flooding usage_events when credits chip / usage page poll often.
  if (
    lastCreditSnapshotValue === remaining &&
    now - lastCreditSnapshotAt < 15 * 60 * 1000
  ) {
    return;
  }
  lastCreditSnapshotAt = now;
  lastCreditSnapshotValue = remaining;
  recordUsageEvent({
    service: "scrapecreators",
    metric: "credit_snapshot",
    delta: remaining,
    unit: "credits",
  });
}

function asStr(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v : undefined;
}

function asNum(v: unknown): number | undefined {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : undefined;
}

async function listSupabaseUsage(pageSize: number): Promise<UsageEvent[]> {
  const auth = await supabaseAuth();
  if (!auth) return [];
  const qs = new URLSearchParams({
    select: "id,service,metric,delta,unit,path,method,status_code,detail,occurred_at",
    order: "occurred_at.desc",
    limit: String(Math.min(500, Math.max(1, pageSize))),
  });
  const res = await fetch(`${auth.url}/rest/v1/usage_events?${qs}`, {
    headers: {
      apikey: auth.key,
      Authorization: `Bearer ${auth.key}`,
    },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    if (noteSupabaseUsageError(res.status, body)) return [];
    throw new Error(`usage list failed ${res.status}: ${body.slice(0, 300)}`);
  }
  const rows = (await res.json()) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    id: String(row.id ?? ""),
    service: asStr(row.service) || "unknown",
    metric: asStr(row.metric) || "usage",
    delta: asNum(row.delta) ?? 0,
    unit: asStr(row.unit) || "count",
    path: asStr(row.path),
    method: asStr(row.method),
    status: asNum(row.status_code),
    detail: asStr(row.detail),
    at: asStr(row.occurred_at) || "",
  }));
}

export async function listUsageEvents(pageSize = 100): Promise<UsageEvent[]> {
  if (await supabaseConfigured()) {
    const rows = await listSupabaseUsage(pageSize);
    if (!supabaseUsageTableMissing) return rows;
  }
  const db = connectionsEnv().DB;
  if (db) return listD1Usage(db, pageSize);
  const table = await usageTableId();
  const auth = await token();
  if (!table || !auth) return [];

  const qs = new URLSearchParams({
    pageSize: String(Math.min(100, Math.max(1, pageSize))),
  });
  const url = `https://api.airtable.com/v0/${await baseId()}/${table}?${qs}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${auth}` },
    signal: AbortSignal.timeout(20_000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`usage list failed ${res.status}: ${body.slice(0, 300)}`);
  }

  const data = (await res.json()) as {
    records?: Array<{
      id: string;
      createdTime?: string;
      fields: Record<string, unknown>;
    }>;
  };

  const events: UsageEvent[] = (data.records || []).map((r) => {
    const f = r.fields;
    return {
      id: r.id,
      service: (asStr(f.Service) as UsageService) || "airtable",
      metric: (asStr(f.Metric) as UsageMetric) || "api_request",
      delta: asNum(f.Delta) ?? 0,
      unit: (asStr(f.Unit) as UsageUnit) || "count",
      path: asStr(f.Path),
      method: asStr(f.Method),
      status: asNum(f["Status Code"]),
      detail: asStr(f.Detail),
      at: asStr(f["Occurred At"]) || r.createdTime || "",
    };
  });

  events.sort(
    (a, b) => new Date(b.at).getTime() - new Date(a.at).getTime(),
  );
  return events;
}

export type UsageSummary = {
  configured: boolean;
  airtableRequests: number;
  r2UploadBytes: number;
  r2UploadCount: number;
  lastCreditSnapshot: number | null;
  lastCreditSnapshotAt: string | null;
  byDay: Array<{
    day: string;
    airtableRequests: number;
    r2UploadBytes: number;
  }>;
  events: UsageEvent[];
};

export function summarizeUsageEvents(events: UsageEvent[]): Omit<
  UsageSummary,
  "configured"
> {
  let airtableRequests = 0;
  let r2UploadBytes = 0;
  let r2UploadCount = 0;
  let lastCreditSnapshot: number | null = null;
  let lastCreditSnapshotAt: string | null = null;

  const dayMap = new Map<
    string,
    { airtableRequests: number; r2UploadBytes: number }
  >();

  for (const e of events) {
    const day = e.at ? e.at.slice(0, 10) : "unknown";
    if (!dayMap.has(day)) {
      dayMap.set(day, { airtableRequests: 0, r2UploadBytes: 0 });
    }
    const bucket = dayMap.get(day)!;

    if (e.service === "airtable" && e.metric === "api_request") {
      airtableRequests += e.delta;
      bucket.airtableRequests += e.delta;
    }
    if (e.service === "r2" && e.metric === "upload_bytes") {
      r2UploadBytes += e.delta;
      r2UploadCount += 1;
      bucket.r2UploadBytes += e.delta;
    }
    if (
      e.service === "scrapecreators" &&
      e.metric === "credit_snapshot" &&
      lastCreditSnapshotAt == null
    ) {
      // events are newest-first
      lastCreditSnapshot = e.delta;
      lastCreditSnapshotAt = e.at || null;
    }
  }

  const byDay = [...dayMap.entries()]
    .filter(([d]) => d !== "unknown")
    .sort((a, b) => b[0].localeCompare(a[0]))
    .slice(0, 14)
    .map(([day, v]) => ({ day, ...v }))
    .reverse();

  return {
    airtableRequests,
    r2UploadBytes,
    r2UploadCount,
    lastCreditSnapshot,
    lastCreditSnapshotAt,
    byDay,
    events,
  };
}

export async function usageTrackingConfigured(): Promise<boolean> {
  return (
    (await supabaseConfigured()) ||
    Boolean(connectionsEnv().DB) ||
    Boolean((await usageTableId()) && (await token()))
  );
}

export type UsageSeries = {
  service: string;
  unit: string;
  metrics: string[];
  given: number | null;
  used: number | null;
  remaining: number | null;
  source: string;
};

export type UsageReading = {
  service: string;
  unit: string;
  metric?: string;
  given?: number | null;
  used?: number | null;
  remaining?: number | null;
  source?: string;
};

const SERVICE_LABELS: Record<string, string> = {
  scrapecreators: "ScrapeCreators",
  apify: "Apify",
  r2: "R2",
  airtable: "Airtable",
};

export function usageServiceLabel(service: string): string {
  const known = SERVICE_LABELS[service.toLowerCase()];
  if (known) return known;
  return service
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

/** count is the stored unit for request tallies. The page says "requests". */
export function usageDisplayUnit(unit: string): string {
  return unit === "count" ? "requests" : unit;
}

function metricRole(metric: string): "given" | "remaining" | "used" {
  const name = metric.toLowerCase();
  if (
    name === "allowance" ||
    name === "quota" ||
    name === "given" ||
    name.endsWith("_allowance")
  ) {
    return "given";
  }
  if (
    name.endsWith("_snapshot") ||
    name === "balance" ||
    name === "remaining" ||
    name.endsWith("_balance")
  ) {
    return "remaining";
  }
  return "used";
}

function completeUsage(row: {
  given: number | null;
  used: number | null;
  remaining: number | null;
}): { given: number | null; used: number | null; remaining: number | null } {
  let { given, used, remaining } = row;
  if (given == null && remaining != null && used != null) given = remaining + used;
  if (remaining == null && given != null && used != null) remaining = given - used;
  if (used == null && given != null && remaining != null) used = given - remaining;
  return { given, used, remaining };
}

/**
 * One card per service + unit.
 * Counters add to used. The newest balance snapshot is remaining.
 * The newest allowance is given. The missing number is filled from the other two.
 */
export function summarizeUsageSeries(events: UsageEvent[]): UsageSeries[] {
  type Bucket = UsageSeries & { givenAt: number; remainingAt: number };
  const groups = new Map<string, Bucket>();
  const ordered = [...events].sort(
    (a, b) => new Date(a.at).getTime() - new Date(b.at).getTime(),
  );

  for (const event of ordered) {
    const key = `${event.service}\0${event.unit}`;
    let bucket = groups.get(key);
    if (!bucket) {
      bucket = {
        service: event.service,
        unit: event.unit,
        metrics: [],
        given: null,
        used: null,
        remaining: null,
        source: "ledger",
        givenAt: Number.NEGATIVE_INFINITY,
        remainingAt: Number.NEGATIVE_INFINITY,
      };
      groups.set(key, bucket);
    }
    if (!bucket.metrics.includes(event.metric)) bucket.metrics.push(event.metric);
    const at = new Date(event.at).getTime();
    const role = metricRole(event.metric);
    if (role === "used") {
      bucket.used = (bucket.used ?? 0) + event.delta;
    } else if (role === "remaining" && at >= bucket.remainingAt) {
      bucket.remaining = event.delta;
      bucket.remainingAt = at;
    } else if (role === "given" && at >= bucket.givenAt) {
      bucket.given = event.delta;
      bucket.givenAt = at;
    }
  }

  return [...groups.values()]
    .map((bucket) => {
      const filled = completeUsage(bucket);
      return {
        service: bucket.service,
        unit: bucket.unit,
        metrics: [...bucket.metrics].sort(),
        source: bucket.source,
        ...filled,
      };
    })
    .sort(
      (a, b) =>
        a.service.localeCompare(b.service) || a.unit.localeCompare(b.unit),
    );
}

/** Overlay a live provider reading onto the series for that service and unit. */
export function mergeUsageReading(
  series: UsageSeries[],
  reading: UsageReading,
): UsageSeries[] {
  const next = series.map((row) => ({ ...row, metrics: [...row.metrics] }));
  const index = next.findIndex(
    (row) => row.service === reading.service && row.unit === reading.unit,
  );
  const apply = (row: UsageSeries) => {
    if (reading.metric && !row.metrics.includes(reading.metric)) {
      row.metrics.push(reading.metric);
      row.metrics.sort();
    }
    if (reading.remaining != null) row.remaining = reading.remaining;
    if (reading.given != null) row.given = reading.given;
    if (reading.used != null) row.used = reading.used;
    if (reading.source) row.source = reading.source;
    const filled = completeUsage(row);
    row.given = filled.given;
    row.used = filled.used;
    row.remaining = filled.remaining;
  };

  if (index < 0) {
    const row: UsageSeries = {
      service: reading.service,
      unit: reading.unit,
      metrics: reading.metric ? [reading.metric] : [],
      given: reading.given ?? null,
      used: reading.used ?? null,
      remaining: reading.remaining ?? null,
      source: reading.source ?? "live",
    };
    apply(row);
    next.push(row);
  } else {
    apply(next[index]!);
  }

  return next.sort(
    (a, b) => a.service.localeCompare(b.service) || a.unit.localeCompare(b.unit),
  );
}
