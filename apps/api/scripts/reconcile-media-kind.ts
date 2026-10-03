/**
 * Point each saved media row at the file R2 actually stored.
 * Copies an object when its extension disagrees, then updates Type and File type.
 *
 *   node --env-file=../../.env --import tsx scripts/reconcile-media-kind.ts
 */
import { listRecords, updateMedia } from "../src/lib/airtable.ts";
import {
  copyHostedObject,
  deleteHostedKey,
  inspectHostedFile,
  isHostedMediaUrl,
  type DetectedMedia,
} from "../src/lib/r2.ts";

const mediaTable = process.env.AIRTABLE_MEDIA_TABLE ?? "tbly36b1qJiRbfEL2";

function extOf(url: string): string {
  try {
    return new URL(url).pathname.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase() ?? "";
  } catch {
    return "";
  }
}

function extensionMatches(url: string, detected: DetectedMedia): boolean {
  const ext = extOf(url);
  if (ext === detected.ext) return true;
  return detected.ext === "jpg" && (ext === "jpg" || ext === "jpeg");
}

function typeMatches(stored: string, detected: DetectedMedia): boolean {
  const type = stored.toLowerCase();
  if (detected.kind === "video") return type === "video";
  if (detected.kind === "gif") return type === "gif";
  return type === "image" || type === "photo";
}

function fileTypeMatches(stored: string, detected: DetectedMedia): boolean {
  return stored.split(";")[0]?.trim().toLowerCase() === detected.fileType;
}

function airtableType(detected: DetectedMedia): string {
  if (detected.kind === "gif") return "gif";
  if (detected.kind === "video") return "video";
  return "image";
}

let offset: string | undefined;
let scanned = 0;
let changed = 0;
let failed = 0;

do {
  const page = await listRecords(mediaTable, { pageSize: 100, offset });
  for (const row of page.records) {
    const saved = String(row.fields["Saved copy"] ?? "").trim();
    if (!saved || !isHostedMediaUrl(saved)) continue;
    scanned += 1;
    const storedType = String(row.fields.Type ?? "");
    const storedFileType = String(row.fields["File type"] ?? "");
    try {
      const detected = await inspectHostedFile(saved);
      const extOk = extensionMatches(saved, detected);
      const typeOk = typeMatches(storedType, detected);
      const fileOk = fileTypeMatches(storedFileType, detected);
      if (extOk && typeOk && fileOk) continue;

      let nextUrl = saved;
      let sourceKey = "";
      if (!extOk) {
        const copied = await copyHostedObject({
          sourceUrl: saved,
          ext: detected.ext,
          contentType: detected.fileType,
        });
        nextUrl = copied.publicUrl;
        if (copied.copied) sourceKey = copied.sourceKey;
      }

      await updateMedia(row.id, {
        ...(nextUrl !== saved ? { "Saved copy": nextUrl } : {}),
        ...(!typeOk ? { Type: airtableType(detected) } : {}),
        ...(!fileOk ? { "File type": detected.fileType } : {}),
      });
      if (sourceKey) await deleteHostedKey(sourceKey);
      changed += 1;
      console.log(
        JSON.stringify({
          id: row.id,
          from: { type: storedType, fileType: storedFileType, url: saved },
          to: {
            type: typeOk ? storedType : airtableType(detected),
            fileType: fileOk ? storedFileType : detected.fileType,
            url: nextUrl,
          },
        }),
      );
    } catch (err) {
      failed += 1;
      const message = err instanceof Error ? err.message : String(err);
      console.error(JSON.stringify({ id: row.id, error: message }));
    }
  }
  offset = page.offset;
} while (offset);

console.log(JSON.stringify({ scanned, changed, failed }));
if (failed) process.exitCode = 1;
