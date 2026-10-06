export type SocialPlatform = "tiktok" | "instagram" | "x";

const TRACKING =
  /^(utm_|fbclid$|igsh$|igshid$|si$|_r$|_t$|is_from_webapp$|sender_device$|sender_web_id$)/i;

function stripInvisible(raw: string): string {
  return raw.replace(/[\u200B-\u200D\uFEFF]/g, "");
}

function unwrapMobileRedirect(url: URL): URL {
  const host = url.hostname.replace(/^www\./, "").toLowerCase();
  const wrapped =
    host === "l.instagram.com"
      ? url.searchParams.get("u")
      : host.endsWith("instagram.com") &&
          url.pathname.replace(/\/+$/, "") === "/accounts/login"
        ? url.searchParams.get("next")
        : null;
  if (!wrapped) return url;
  try {
    const inner = new URL(wrapped);
    if (inner.protocol === "http:" || inner.protocol === "https:") return inner;
  } catch {
    return url;
  }
  return url;
}

/** Pull the first link out of a mobile share paste and drop tracking params. */
export function normalizeUrl(raw: string): string | null {
  const match = stripInvisible(raw).match(/https?:\/\/[^\s"'<>]+/i);
  if (!match) return null;

  const candidate = match[0].replace(/[),.;!?]+$/g, "");
  try {
    const url = unwrapMobileRedirect(new URL(candidate));
    for (const key of [...url.searchParams.keys()]) {
      if (TRACKING.test(key)) url.searchParams.delete(key);
    }
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

/** Host check for full links and mobile short domains. */
export function detectPlatform(url: string): SocialPlatform | null {
  let host: string;
  try {
    host = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }

  if (host === "tiktok.com" || host.endsWith(".tiktok.com")) return "tiktok";
  if (
    host === "instagram.com" ||
    host === "instagr.am" ||
    host.endsWith(".instagram.com")
  ) {
    return "instagram";
  }
  if (
    host === "x.com" ||
    host === "twitter.com" ||
    host.endsWith(".twitter.com")
  ) {
    return "x";
  }
  return null;
}

export function platformLabel(platform: SocialPlatform): string {
  if (platform === "tiktok") return "TikTok";
  if (platform === "instagram") return "Instagram";
  return "X";
}
