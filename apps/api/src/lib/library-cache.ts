import { timingSafeEqual } from "node:crypto";
import { connectionsEnv } from "../connections/runtime.js";
import { getAppSecret } from "../connections/secrets.js";

export const LIBRARY_KEY = "library:v1";
const TTL_SECONDS = 60;

export type LibraryKv = {
  get(key: string, type: "json"): Promise<unknown>;
  put(
    key: string,
    value: string,
    options?: { expirationTtl?: number },
  ): Promise<void>;
  delete(key: string): Promise<void>;
};

let libraryKv: LibraryKv | undefined;

export function setLibraryKv(kv: LibraryKv | undefined) {
  libraryKv = kv;
}

export async function readLibrary<T>(): Promise<T | null> {
  if (!libraryKv) return null;
  try {
    const value = await libraryKv.get(LIBRARY_KEY, "json");
    if (value == null) return null;
    return value as T;
  } catch (err) {
    console.warn(
      "[library-cache] read failed",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

export async function writeLibrary(value: unknown): Promise<void> {
  if (!libraryKv) return;
  try {
    await libraryKv.put(LIBRARY_KEY, JSON.stringify(value), {
      expirationTtl: TTL_SECONDS,
    });
  } catch (err) {
    console.warn(
      "[library-cache] write failed",
      err instanceof Error ? err.message : err,
    );
  }
}

/** Delete the key when this process has the Worker binding. */
export async function deleteLibraryCache(): Promise<void> {
  if (!libraryKv) return;
  await libraryKv.delete(LIBRARY_KEY);
}

export async function isBustAuthorized(authorization: string | undefined): Promise<boolean> {
  const secret = (await getAppSecret(connectionsEnv(), "library_bust_secret"))?.trim();
  if (!secret) return false;
  const presented = authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim()
    : "";
  const actual = Buffer.from(secret);
  const given = Buffer.from(presented);
  if (actual.length === 0 || actual.length !== given.length) return false;
  return timingSafeEqual(actual, given);
}

/**
 * Worker: delete KV directly.
 * Trigger.dev: POST the protected bust route. A bust failure does not fail the save.
 */
export async function invalidateLibrary(): Promise<void> {
  try {
    if (libraryKv) {
      await libraryKv.delete(LIBRARY_KEY);
      return;
    }
    const url = (await getAppSecret(connectionsEnv(), "library_bust_url"))?.trim();
    const secret = (await getAppSecret(connectionsEnv(), "library_bust_secret"))?.trim();
    if (!url || !secret) return;
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}` },
    });
    if (!res.ok) {
      console.warn(`[library-cache] bust failed ${res.status}`);
    }
  } catch (err) {
    console.warn(
      "[library-cache] invalidate failed",
      err instanceof Error ? err.message : err,
    );
  }
}
