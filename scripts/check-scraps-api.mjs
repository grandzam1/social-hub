#!/usr/bin/env node
const res = await fetch("http://127.0.0.1:8787/api/scraps?type=all");
const j = await res.json();
const page = await fetch("http://127.0.0.1:8787/scraps");
console.log({
  api: res.status,
  ok: j.ok,
  error: j.error,
  counts: j.counts,
  users: (j.users || []).slice(0, 10),
  sample: (j.items || []).slice(0, 4).map((i) => ({
    kind: i.kind,
    user: i.user,
    when: i.savedAt,
    hasPreview: Boolean(i.previewUrl || i.fileUrl || i.text),
  })),
  page: page.status,
});
