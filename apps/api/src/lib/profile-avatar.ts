import { connectionsEnv } from "../connections/runtime.js";
import { getCatalog } from "../catalog/index.js";
import { getScraper } from "../platforms/index.js";
import { invalidateLibrary } from "./library-cache.js";
import { isHostedMediaUrl, transferCdnToR2 } from "./r2.js";

async function findPostLink(handle: string, platform: string) {
  return (await getCatalog(connectionsEnv())).findPostLink(handle, platform);
}

async function findProfile(handle: string, platform: string) {
  return (await getCatalog(connectionsEnv())).findProfile(handle, platform);
}

async function updateProfile(recordId: string, fields: Record<string, unknown>) {
  return (await getCatalog(connectionsEnv())).updateProfile(recordId, fields);
}

const failed = new Set<string>();
const inflight = new Map<string, Promise<string | null>>();

function bareHandle(handle: string): string {
  return handle.replace(/^@/, "").trim().toLowerCase();
}

function avatarKey(platform: string, handle: string): string {
  const safePlatform = platform.toLowerCase().replace(/[^a-z0-9]+/g, "") || "profile";
  const safeHandle = bareHandle(handle).replace(/[^a-z0-9._-]+/g, "") || "unknown";
  return `social-hub/avatars/${safePlatform}/${safeHandle}.jpg`;
}

/** Download a profile image once and store it under the username. */
export async function saveAvatarToR2(options: {
  platform: string;
  handle: string;
  sourceUrl: string;
}): Promise<string> {
  if (await isHostedMediaUrl(options.sourceUrl)) return options.sourceUrl;
  const uploaded = await transferCdnToR2({
    url: options.sourceUrl,
    objectKey: avatarKey(options.platform, options.handle),
    mediaRecordId: `avatar-${bareHandle(options.handle)}`,
    mediaType: "image",
  });
  return uploaded.publicUrl;
}

async function storedUrlWorks(url: string): Promise<boolean> {
  if (!url || (await isHostedMediaUrl(url))) return false;
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
        Accept: "image/*,*/*",
        Referer: url.includes("cdninstagram.com")
          ? "https://www.instagram.com/"
          : "https://x.com/",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(20_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** One fresh picture from a post this user already has. Does not write the post. */
async function avatarFromExistingPost(
  platform: string,
  handle: string,
): Promise<string> {
  const link = await findPostLink(handle, platform);
  if (!link) return "";
  const scraper = await getScraper(connectionsEnv());
  const normalized = await scraper.fetchPost(link);
  return normalized.authorAvatar?.trim() || "";
}

async function avatarSource(
  platform: string,
  handle: string,
  stored: string,
): Promise<string> {
  if (stored && (await storedUrlWorks(stored))) return stored;
  return avatarFromExistingPost(platform, handle);
}

/**
 * Return the saved avatar for this username.
 * A profile that already has one is reused. A platform link is saved once.
 */
export async function ensureSavedAvatar(
  platform: string,
  handle: string,
): Promise<string | null> {
  const key = `${platform.toLowerCase()}:${bareHandle(handle)}`;
  if (!platform || !bareHandle(handle) || failed.has(key)) return null;
  const pending = inflight.get(key);
  if (pending) return pending;

  const job = (async () => {
    const profile = await findProfile(handle, platform);
    if (!profile) return null;
    const current = String(profile.fields.Avatar ?? profile.fields.avatar ?? "");
    if (current && (await isHostedMediaUrl(current))) return current;
    const source = await avatarSource(platform, handle, current);
    if (!source) {
      failed.add(key);
      return null;
    }
    try {
      const saved = await saveAvatarToR2({
        platform,
        handle,
        sourceUrl: source,
      });
      await updateProfile(profile.id, { Avatar: saved });
      await invalidateLibrary();
      return saved;
    } catch {
      failed.add(key);
      return null;
    }
  })().finally(() => {
    inflight.delete(key);
  });

  inflight.set(key, job);
  return job;
}
