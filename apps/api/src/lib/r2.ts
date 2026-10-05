import { Readable } from "node:stream";
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { DOMParser, Node as XmlNode } from "@xmldom/xmldom";
import { connectionsEnv } from "../connections/runtime.js";
import { getAppSecret } from "../connections/secrets.js";
import { recordR2Upload } from "./usage.js";

const DEFAULT_R2_BUCKET = "scrape-kit-media";
const DEFAULT_R2_PUBLIC_BASE = "https://pub-dd096d99ffc0494a9164b431ea60c9c6.r2.dev";

export type DetectedMedia = {
  kind: "image" | "video" | "gif";
  ext: string;
  fileType: string;
};

type R2Config = {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  publicBase: string;
};

async function r2Config(): Promise<R2Config> {
  const env = connectionsEnv();
  const accountId = (await getAppSecret(env, "r2_account_id"))?.trim() ?? "";
  const accessKeyId = (await getAppSecret(env, "r2_access_key_id"))?.trim() ?? "";
  const secretAccessKey = (await getAppSecret(env, "r2_secret_access_key"))?.trim() ?? "";
  if (!accountId) throw new Error("Missing env var: R2_ACCOUNT_ID");
  if (!accessKeyId) throw new Error("Missing env var: R2_ACCESS_KEY_ID");
  if (!secretAccessKey) throw new Error("Missing env var: R2_SECRET_ACCESS_KEY");
  const bucket = (await getAppSecret(env, "r2_bucket"))?.trim() || DEFAULT_R2_BUCKET;
  const publicBase = (
    (await getAppSecret(env, "r2_public_base_url"))?.trim() || DEFAULT_R2_PUBLIC_BASE
  ).replace(/\/$/, "");
  return { accountId, accessKeyId, secretAccessKey, bucket, publicBase };
}

function publicUrl(base: string, key: string): string {
  return `${base.replace(/\/$/, "")}/${key}`;
}

/** True when the URL is already a file we host. */
export async function isHostedMediaUrl(url: string): Promise<boolean> {
  const base = (
    (await getAppSecret(connectionsEnv(), "r2_public_base_url"))?.trim() ||
    DEFAULT_R2_PUBLIC_BASE
  ).replace(/\/$/, "");
  return url.startsWith(`${base}/`);
}

function isApifyApiUrl(url: string): boolean {
  try {
    return new URL(url).hostname === "api.apify.com";
  } catch {
    return false;
  }
}

async function cdnHeaders(url: string): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
    Accept: "*/*",
    "Accept-Language": "en-US,en;q=0.9",
  };
  if (url.includes("twimg.com")) headers.Referer = "https://x.com/";
  else if (url.includes("cdninstagram.com") || url.includes("instagram.com")) {
    headers.Referer = "https://www.instagram.com/";
  } else if (url.includes("tiktokcdn.com") || url.includes("tiktok.com")) {
    headers.Referer = "https://www.tiktok.com/";
  }
  if (isApifyApiUrl(url)) {
    const token = (await getAppSecret(connectionsEnv(), "apify"))?.trim();
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

/** Storage included with an R2 account. Not a hard cap on paid use. */
export const R2_INCLUDED_BYTES = 10 * 1024 * 1024 * 1024;

export type R2StorageUsage = {
  bytes: number;
  objects: number;
  truncated: boolean;
};

const STORAGE_CACHE_MS = 5 * 60 * 1000;
let storageCache: { at: number; value: R2StorageUsage } | null = null;

/**
 * Sum object sizes in the bucket.
 * One list page is an R2 Class A request. The result is reused for 5 minutes.
 */
function ensureXmlParser() {
  const scope = globalThis as typeof globalThis & {
    DOMParser?: typeof DOMParser;
    Node?: typeof XmlNode;
  };
  if (typeof scope.DOMParser === "undefined") scope.DOMParser = DOMParser;
  if (typeof scope.Node === "undefined") scope.Node = XmlNode;
}

export async function measureR2Bucket(): Promise<R2StorageUsage> {
  if (storageCache && Date.now() - storageCache.at < STORAGE_CACHE_MS) {
    return storageCache.value;
  }
  ensureXmlParser();
  const { s3, bucket } = await openR2();
  let token: string | undefined;
  let bytes = 0;
  let objects = 0;
  let truncated = false;
  const maxPages = 50;
  for (let page = 0; page < maxPages; page += 1) {
    const out = await s3.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        ContinuationToken: token,
        MaxKeys: 1000,
      }),
    );
    for (const item of out.Contents ?? []) {
      bytes += item.Size ?? 0;
      objects += 1;
    }
    if (!out.IsTruncated || !out.NextContinuationToken) break;
    token = out.NextContinuationToken;
    truncated = page === maxPages - 1;
  }
  const value = { bytes, objects, truncated };
  storageCache = { at: Date.now(), value };
  return value;
}

async function openR2(): Promise<{ s3: S3Client; bucket: string; publicBase: string }> {
  const cfg = await r2Config();
  return {
    s3: new S3Client({
      region: "auto",
      endpoint: `https://${cfg.accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: cfg.accessKeyId,
        secretAccessKey: cfg.secretAccessKey,
      },
    }),
    bucket: cfg.bucket,
    publicBase: cfg.publicBase,
  };
}

/** Download original CDN media (image/video). */
export async function downloadCdnUrl(
  url: string,
): Promise<{ buffer: Buffer; contentType: string; bytes: number }> {
  const res = await fetch(url, {
    headers: await cdnHeaders(url),
    redirect: "follow",
    // Large X videos can exceed this — callers should prefer async for big files
    signal: AbortSignal.timeout(180_000),
  });
  if (!res.ok) throw new Error(`CDN download failed ${res.status}: ${url}`);
  const contentType =
    res.headers.get("content-type") ?? "application/octet-stream";
  const buffer = Buffer.from(await res.arrayBuffer());
  return { buffer, contentType, bytes: buffer.length };
}

/** HEAD to learn size before committing to a sync download. */
export async function headCdnUrl(
  url: string,
): Promise<{ contentLength?: number; contentType?: string }> {
  try {
    const res = await fetch(url, {
      method: "HEAD",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
        ...(url.includes("twimg.com") ? { Referer: "https://x.com/" } : {}),
      },
      signal: AbortSignal.timeout(15_000),
    });
    const len = res.headers.get("content-length");
    return {
      contentLength: len ? Number(len) : undefined,
      contentType: res.headers.get("content-type") ?? undefined,
    };
  } catch {
    return {};
  }
}

/**
 * Download a CDN file and store it on R2.
 * Streams when the source sends Content-Length, so a video is not held in memory.
 */
export async function transferCdnToR2(options: {
  url: string;
  objectKey?: string;
  mediaRecordId: string;
  mediaType?: string;
}): Promise<{
  key: string;
  publicUrl: string;
  bytes: number;
  contentType: string;
  kind: DetectedMedia["kind"];
  fileType: string;
}> {
  const res = await fetch(options.url, {
    headers: await cdnHeaders(options.url),
    redirect: "follow",
    signal: AbortSignal.timeout(180_000),
  });
  if (!res.ok) {
    throw new Error(`CDN download failed ${res.status}: ${options.url}`);
  }
  const headerType =
    res.headers.get("content-type") ?? "application/octet-stream";
  const lengthHeader = res.headers.get("content-length");
  const contentLength = lengthHeader ? Number(lengthHeader) : undefined;

  const webBody = res.body;
  // Workers fetch bodies are not Node web streams. Buffer them.
  const canStream =
    process.env.RUNTIME !== "cloudflare" &&
    Boolean(webBody) &&
    typeof contentLength === "number" &&
    Number.isFinite(contentLength) &&
    typeof (webBody as ReadableStream<Uint8Array>).getReader === "function";

  if (webBody && canStream && contentLength) {
    const detected = resolveDetected({
      contentType: headerType,
      url: options.url,
      claimedType: options.mediaType,
    });
    const key = options.objectKey || objectKey(options.mediaRecordId, detected.ext);
    const contentType = storedContentType(headerType, detected);
    const stored = await openR2();
    await stored.s3.send(
      new PutObjectCommand({
        Bucket: stored.bucket,
        Key: key,
        Body: Readable.fromWeb(webBody as import("node:stream/web").ReadableStream),
        ContentType: contentType,
        ContentLength: contentLength,
      }),
    );
    recordR2Upload({ bytes: contentLength, key });
    return {
      key,
      bytes: contentLength,
      contentType,
      publicUrl: publicUrl(stored.publicBase, key),
      kind: detected.kind,
      fileType: detected.fileType,
    };
  }

  const body = Buffer.from(await res.arrayBuffer());
  const detected = resolveDetected({
    bytes: body,
    contentType: headerType,
    url: options.url,
    claimedType: options.mediaType,
  });
  const key = options.objectKey || objectKey(options.mediaRecordId, detected.ext);
  const contentType = storedContentType(headerType, detected, body);
  const stored = await openR2();
  await stored.s3.send(
    new PutObjectCommand({
      Bucket: stored.bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );
  const bytes = body.length;

  recordR2Upload({ bytes, key });
  return {
    key,
    bytes,
    contentType,
    publicUrl: publicUrl(stored.publicBase, key),
    kind: detected.kind,
    fileType: detected.fileType,
  };
}

/** Upload bytes to R2 and return our hosted public URL. */
export async function uploadToR2(options: {
  key: string;
  body: Buffer;
  contentType: string;
}): Promise<{ key: string; publicUrl: string; bytes: number }> {
  const stored = await openR2();
  await stored.s3.send(
    new PutObjectCommand({
      Bucket: stored.bucket,
      Key: options.key,
      Body: options.body,
      ContentType: options.contentType,
    }),
  );

  recordR2Upload({ bytes: options.body.length, key: options.key });

  return {
    key: options.key,
    bytes: options.body.length,
    publicUrl: publicUrl(stored.publicBase, options.key),
  };
}

const MEDIA_BY_EXT: Record<string, DetectedMedia> = {
  mp4: { kind: "video", ext: "mp4", fileType: "video/mp4" },
  m4v: { kind: "video", ext: "mp4", fileType: "video/mp4" },
  webm: { kind: "video", ext: "webm", fileType: "video/webm" },
  gif: { kind: "gif", ext: "gif", fileType: "image/gif" },
  png: { kind: "image", ext: "png", fileType: "image/png" },
  webp: { kind: "image", ext: "webp", fileType: "image/webp" },
  jpg: { kind: "image", ext: "jpg", fileType: "image/jpeg" },
  jpeg: { kind: "image", ext: "jpg", fileType: "image/jpeg" },
};

function mimeBase(contentType: string): string {
  return contentType.split(";")[0]?.trim().toLowerCase() ?? "";
}

function fromContentType(contentType?: string): DetectedMedia | null {
  const ct = mimeBase(contentType || "");
  if (!ct || ct === "application/octet-stream" || ct === "binary/octet-stream") {
    return null;
  }
  if (ct.includes("mp4")) return MEDIA_BY_EXT.mp4;
  if (ct.includes("webm")) return MEDIA_BY_EXT.webm;
  if (ct.includes("gif")) return MEDIA_BY_EXT.gif;
  if (ct.includes("png")) return MEDIA_BY_EXT.png;
  if (ct.includes("webp")) return MEDIA_BY_EXT.webp;
  if (ct.includes("jpeg") || ct.includes("jpg")) return MEDIA_BY_EXT.jpg;
  if (ct.startsWith("video/")) return MEDIA_BY_EXT.mp4;
  if (ct.startsWith("image/")) return MEDIA_BY_EXT.jpg;
  return null;
}

function fromUrl(url?: string): DetectedMedia | null {
  if (!url) return null;
  let path = url.split("?")[0] ?? url;
  try {
    path = new URL(url).pathname;
  } catch {
    // Keep the path before the query string.
  }
  const match = path.match(/\.([a-z0-9]+)$/i);
  if (!match) return null;
  return MEDIA_BY_EXT[match[1].toLowerCase()] ?? null;
}

function fromClaimed(claimedType?: string): DetectedMedia | null {
  const claimed = String(claimedType || "").toLowerCase();
  if (claimed === "video") return MEDIA_BY_EXT.mp4;
  if (claimed === "gif" || claimed === "animated_gif") return MEDIA_BY_EXT.gif;
  if (claimed === "image" || claimed === "photo") return MEDIA_BY_EXT.jpg;
  return null;
}

function sniffBytes(bytes?: Buffer): DetectedMedia | null {
  if (!bytes || bytes.length < 3) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return MEDIA_BY_EXT.jpg;
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes.toString("ascii", 1, 4) === "PNG") {
    return MEDIA_BY_EXT.png;
  }
  if (bytes.length >= 6) {
    const gif = bytes.toString("ascii", 0, 6);
    if (gif === "GIF87a" || gif === "GIF89a") return MEDIA_BY_EXT.gif;
  }
  if (
    bytes.length >= 12 &&
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP"
  ) {
    return MEDIA_BY_EXT.webp;
  }
  if (bytes.length >= 12 && bytes.toString("ascii", 4, 8) === "ftyp") return MEDIA_BY_EXT.mp4;
  if (
    bytes[0] === 0x1a &&
    bytes[1] === 0x45 &&
    bytes[2] === 0xdf &&
    bytes[3] === 0xa3
  ) {
    return MEDIA_BY_EXT.webm;
  }
  return null;
}

/**
 * The file wins over the label: magic bytes, then a specific content type,
 * then the URL path, then the claimed media type.
 */
export function detectMediaKind(input: {
  contentType?: string;
  url?: string;
  claimedType?: string;
  bytes?: Buffer;
}): DetectedMedia | null {
  return (
    sniffBytes(input.bytes) ||
    fromContentType(input.contentType) ||
    fromUrl(input.url) ||
    fromClaimed(input.claimedType)
  );
}

function resolveDetected(input: {
  contentType?: string;
  url?: string;
  claimedType?: string;
  bytes?: Buffer;
}): DetectedMedia {
  return (
    detectMediaKind(input) ?? {
      kind: "image",
      ext: "jpg",
      fileType: "image/jpeg",
    }
  );
}

function storedContentType(
  headerType: string,
  detected: DetectedMedia,
  bytes?: Buffer,
): string {
  const sniffed = sniffBytes(bytes);
  if (sniffed) return sniffed.fileType;
  if (fromContentType(headerType)) return mimeBase(headerType);
  return detected.fileType;
}

function objectKey(mediaRecordId: string, ext: string): string {
  return `social-hub/${mediaRecordId}/${Date.now()}.${ext}`;
}

async function keyFromPublicUrl(url: string): Promise<string | null> {
  if (!(await isHostedMediaUrl(url))) return null;
  const base = (
    (await getAppSecret(connectionsEnv(), "r2_public_base_url"))?.trim() ||
    DEFAULT_R2_PUBLIC_BASE
  ).replace(/\/$/, "");
  const key = url.slice(base.length + 1).split("?")[0];
  return key || null;
}

function keyWithExt(key: string, ext: string): string {
  if (/\.[a-z0-9]+$/i.test(key)) return key.replace(/\.[a-z0-9]+$/i, `.${ext}`);
  return `${key}.${ext}`;
}

/** Read the kind R2 actually stored, using the object content type and bytes. */
export async function inspectHostedFile(url: string): Promise<DetectedMedia> {
  const head = await fetch(url, {
    method: "HEAD",
    signal: AbortSignal.timeout(15_000),
  });
  const headerType = head.ok ? (head.headers.get("content-type") ?? "") : "";
  const fromHeader = fromContentType(headerType);
  if (fromHeader) return fromHeader;
  const res = await fetch(url, {
    headers: { Range: "bytes=0-31" },
    signal: AbortSignal.timeout(15_000),
  });
  const bytes = Buffer.from(await res.arrayBuffer());
  return resolveDetected({ bytes, contentType: headerType, url });
}

/**
 * Copy a hosted object onto a key whose extension matches the file.
 * Caller deletes the source after the new URL is saved.
 */
export async function copyHostedObject(options: {
  sourceUrl: string;
  ext: string;
  contentType: string;
}): Promise<{ publicUrl: string; key: string; sourceKey: string; copied: boolean }> {
  const sourceKey = await keyFromPublicUrl(options.sourceUrl);
  if (!sourceKey) throw new Error(`Not a hosted media URL: ${options.sourceUrl}`);
  const destKey = keyWithExt(sourceKey, options.ext);
  if (destKey === sourceKey) {
    return {
      publicUrl: options.sourceUrl,
      key: sourceKey,
      sourceKey,
      copied: false,
    };
  }
  const stored = await openR2();
  await stored.s3.send(
    new CopyObjectCommand({
      Bucket: stored.bucket,
      CopySource: `${stored.bucket}/${sourceKey}`,
      Key: destKey,
      ContentType: options.contentType,
      MetadataDirective: "REPLACE",
    }),
  );
  return { publicUrl: publicUrl(stored.publicBase, destKey), key: destKey, sourceKey, copied: true };
}

export async function deleteHostedKey(key: string): Promise<void> {
  const stored = await openR2();
  await stored.s3.send(
    new DeleteObjectCommand({
      Bucket: stored.bucket,
      Key: key,
    }),
  );
}

export function guessExt(contentType: string, mediaType?: string, url?: string): string {
  return detectMediaKind({ contentType, url, claimedType: mediaType })?.ext ?? "jpg";
}
