export type SaveStatus = "pending" | "saved" | "failed";

/** Read the dedicated field. Older rows fall back to File status labels. */
export function readSaveStatus(fields: Record<string, unknown>): SaveStatus {
  const explicit = String(fields.saveStatus ?? "")
    .trim()
    .toLowerCase();
  if (explicit === "pending" || explicit === "saved" || explicit === "failed") {
    return explicit;
  }
  const legacy = String(fields["File status"] ?? "");
  if (/saved copy ready/i.test(legacy)) return "saved";
  if (/^failed$/i.test(legacy)) return "failed";
  return "pending";
}

/** Persist saveStatus and keep the legacy File status column in step. */
export function saveStatusFields(status: SaveStatus): Record<string, string> {
  const fileStatus =
    status === "saved"
      ? "Saved copy ready"
      : status === "failed"
        ? "Failed"
        : "File link ready";
  return { saveStatus: status, "File status": fileStatus };
}
