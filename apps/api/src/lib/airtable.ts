function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var: ${name}`);
  return value;
}

function baseId() {
  return process.env.AIRTABLE_BASE_ID ?? "appkPrLfwDGwIIbTL";
}

function mediaTable() {
  return process.env.AIRTABLE_MEDIA_TABLE ?? "tbly36b1qJiRbfEL2";
}

function postsTable() {
  return process.env.AIRTABLE_POSTS_TABLE ?? "tblxevZB9wCX1N3WF";
}

function profilesTable() {
  return process.env.AIRTABLE_PROFILES_TABLE ?? "tblD49NYtqd3vdOTI";
}

function token() {
  return (
    process.env.AIRTABLE_TOKEN ||
    process.env.AIRTABLE_API_KEY ||
    required("AIRTABLE_TOKEN")
  );
}

async function airtableFetch(path: string, init?: RequestInit) {
  const res = await fetch(`https://api.airtable.com/v0/${baseId()}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token()}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    throw new Error(
      `Airtable ${init?.method ?? "GET"} ${path}: ${res.status} ${await res.text()}`,
    );
  }
  return res.json();
}

export type AirtableRecord = { id: string; fields: Record<string, unknown>; createdTime?: string };

function formulaEq(field: string, value: string) {
  const escaped = value.replace(/'/g, "\\'");
  return `{${field}}='${escaped}'`;
}

async function findOne(
  table: string,
  formula: string,
): Promise<AirtableRecord | null> {
  const qs = new URLSearchParams({
    filterByFormula: formula,
    maxRecords: "1",
  });
  const data = (await airtableFetch(`/${table}?${qs}`)) as {
    records: AirtableRecord[];
  };
  return data.records[0] ?? null;
}

export async function listRecords(
  table: string,
  options?: {
    pageSize?: number;
    offset?: string;
    sortField?: string;
    sortDir?: "asc" | "desc";
  },
): Promise<{ records: AirtableRecord[]; offset?: string }> {
  const qs = new URLSearchParams();
  qs.set("pageSize", String(options?.pageSize ?? 50));
  if (options?.offset) qs.set("offset", options.offset);
  if (options?.sortField) {
    qs.set("sort[0][field]", options.sortField);
    qs.set("sort[0][direction]", options.sortDir ?? "desc");
  }
  return (await airtableFetch(`/${table}?${qs}`)) as {
    records: AirtableRecord[];
    offset?: string;
  };
}

export async function listPosts(pageSize = 50) {
  try {
    return await listRecords(postsTable(), {
      pageSize,
      sortField: "Scraped",
      sortDir: "desc",
    });
  } catch {
    return listRecords(postsTable(), { pageSize });
  }
}

export async function listMedia(pageSize = 100) {
  return listRecords(mediaTable(), { pageSize: Math.min(pageSize, 100) });
}

async function createRecord(
  table: string,
  fields: Record<string, unknown>,
): Promise<AirtableRecord> {
  return (await airtableFetch(`/${table}`, {
    method: "POST",
    body: JSON.stringify({ fields, typecast: true }),
  })) as AirtableRecord;
}

async function patchRecord(
  table: string,
  recordId: string,
  fields: Record<string, unknown>,
): Promise<AirtableRecord> {
  return (await airtableFetch(`/${table}/${recordId}`, {
    method: "PATCH",
    body: JSON.stringify({ fields, typecast: true }),
  })) as AirtableRecord;
}

export async function getMedia(recordId: string): Promise<AirtableRecord> {
  return (await airtableFetch(
    `/${mediaTable()}/${recordId}`,
  )) as AirtableRecord;
}

export async function updateMedia(
  recordId: string,
  fields: Record<string, unknown>,
): Promise<AirtableRecord> {
  return patchRecord(mediaTable(), recordId, fields);
}

export async function updatePost(
  recordId: string,
  fields: Record<string, unknown>,
): Promise<AirtableRecord> {
  return patchRecord(postsTable(), recordId, fields);
}

export async function getPost(recordId: string): Promise<AirtableRecord> {
  return (await airtableFetch(
    `/${postsTable()}/${recordId}`,
  )) as AirtableRecord;
}

export async function listMediaForPost(
  postRecordId: string,
): Promise<AirtableRecord[]> {
  const post = await getPost(postRecordId);
  const linked = Array.isArray(post.fields.Files)
    ? (post.fields.Files as string[])
    : [];
  if (!linked.length) {
    // Fallback: Media.Post link (older rows / partial writes)
    const formula = `FIND('${postRecordId.replace(/'/g, "\\'")}', ARRAYJOIN({Post}))`;
    const qs = new URLSearchParams({
      filterByFormula: formula,
      pageSize: "100",
    });
    const data = (await airtableFetch(`/${mediaTable()}?${qs}`)) as {
      records: AirtableRecord[];
    };
    return [...data.records].sort(
      (a, b) => Number(a.fields.Order ?? 0) - Number(b.fields.Order ?? 0),
    );
  }

  const records = await Promise.all(linked.map((id) => getMedia(id)));
  return records.sort(
    (a, b) => Number(a.fields.Order ?? 0) - Number(b.fields.Order ?? 0),
  );
}

export async function upsertProfile(
  fields: Record<string, unknown>,
): Promise<AirtableRecord> {
  const handle = String(fields.Handle ?? "");
  const platform = String(fields.Platform ?? "");
  if (handle && platform) {
    const existing = await findOne(
      profilesTable(),
      `AND(${formulaEq("Handle", handle)},${formulaEq("Platform", platform)})`,
    );
    if (existing) {
      return patchRecord(profilesTable(), existing.id, fields);
    }
  }
  return createRecord(profilesTable(), fields);
}

export async function upsertPost(
  fields: Record<string, unknown>,
): Promise<AirtableRecord> {
  const postId = String(fields["Post ID"] ?? "");
  if (postId) {
    const existing = await findOne(postsTable(), formulaEq("Post ID", postId));
    if (existing) {
      return patchRecord(postsTable(), existing.id, fields);
    }
  }
  return createRecord(postsTable(), fields);
}

export async function upsertMedia(
  fields: Record<string, unknown>,
): Promise<AirtableRecord> {
  const mediaId = String(fields["Media ID"] ?? "");
  if (mediaId) {
    const existing = await findOne(
      mediaTable(),
      formulaEq("Media ID", mediaId),
    );
    if (existing) {
      // Keep existing Saved copy unless caller overwrites
      const merged = { ...fields };
      if (!merged["Saved copy"] && existing.fields["Saved copy"]) {
        delete merged["Saved copy"];
      }
      return patchRecord(mediaTable(), existing.id, merged);
    }
  }
  return createRecord(mediaTable(), fields);
}
