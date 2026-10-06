export type DownloadStatus =
  | "preparing"
  | "downloading"
  | "saving"
  | "done"
  | "failed";

export type DownloadProgressState = {
  isDownloading: boolean;
  loaded: number;
  total: number;
  percent: number;
};

/** Whole-number percent, or null when Content-Length is missing. */
export function downloadPercent(loaded: number, total: number): number | null {
  if (!Number.isFinite(total) || total <= 0) return null;
  if (!Number.isFinite(loaded) || loaded <= 0) return 0;
  return Math.min(100, Math.round((loaded / total) * 100));
}

/**
 * Completed files plus the active file's known percent.
 * Returns null while the active file has no Content-Length.
 */
export function overallDownloadPercent(
  completedFiles: number,
  activeFilePercent: number | null,
  totalFiles: number,
): number | null {
  if (!Number.isFinite(totalFiles) || totalFiles <= 0) return null;
  if (activeFilePercent == null) return null;
  const ratio =
    (completedFiles + Math.min(100, Math.max(0, activeFilePercent)) / 100) /
    totalFiles;
  return Math.min(100, Math.round(ratio * 100));
}

export async function downloadWithProgress(
  url: string,
  onProgress: (loaded: number, total: number) => void,
): Promise<Blob> {
  const response = await fetch(url);
  if (!response.ok) throw new Error("Download failed");

  const headerTotal = Number(response.headers.get("Content-Length") ?? 0);
  const total = Number.isFinite(headerTotal) && headerTotal > 0 ? headerTotal : 0;
  const type = response.headers.get("Content-Type") || "";

  if (!response.body) {
    const blob = await response.blob();
    onProgress(blob.size, total || blob.size);
    return blob;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    chunks.push(value);
    loaded += value.byteLength;
    onProgress(loaded, total);
  }

  const body = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new Blob([body.buffer], type ? { type } : undefined);
}

export function saveBlobToDevice(blob: Blob, filename: string) {
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objectUrl;
  a.download = filename;
  a.rel = "noreferrer";
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 2000);
}
