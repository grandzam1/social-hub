/** Clean duplicated RT / em-dash scrapes into one readable caption. */
export function normalizeCaption(raw?: string | null): string {
  let t = String(raw || "")
    .replace(/\r\n/g, "\n")
    .replace(/\u00a0/g, " ")
    .trim();
  if (!t) return "";

  const chunks = t
    .split(/\s*[—–]{1,2}\s*|\n{2,}/)
    .map((c) => c.trim())
    .filter(Boolean);

  const stripRt = (s: string) => s.replace(/^RT\s+@[\w.]+:\s*/i, "").trim();

  if (chunks.length > 1) {
    const ranked = chunks
      .map((c) => ({ raw: c, body: stripRt(c).toLowerCase() }))
      .filter((c) => c.body.length > 0)
      .sort((a, b) => b.body.length - a.body.length);

    const kept: string[] = [];
    const seen: string[] = [];
    for (const row of ranked) {
      const dup = seen.some(
        (s) => s.includes(row.body) || row.body.includes(s.slice(0, 48)),
      );
      if (dup) continue;
      seen.push(row.body);
      kept.push(row.raw);
    }
    t = kept[0] || t;
  }

  const noRt = stripRt(t);
  if (noRt && noRt.length >= Math.min(40, t.length * 0.5)) {
    if (/^RT\s+@/i.test(t) && noRt.length > 20) t = noRt;
  }

  return t
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[^\S\n]{2,}/g, " ")
    .replace(/\s+([,.!?])/g, "$1")
    .trim();
}
