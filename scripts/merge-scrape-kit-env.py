from pathlib import Path

wanted = [
    "COMPOSIO_API_KEY",
    "COMPOSIO_USER_ID",
    "COMPOSIO_AIRTABLE_ACCOUNT_ID",
    "AIRTABLE_TOKEN",
    "AIRTABLE_BASE_ID",
    "AIRTABLE_POSTS_TABLE",
    "AIRTABLE_MEDIA_TABLE",
    "AIRTABLE_PROFILES_TABLE",
    "R2_ACCOUNT_ID",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
    "R2_BUCKET",
    "R2_PUBLIC_BASE_URL",
]


def load(path: Path) -> dict[str, str]:
    m: dict[str, str] = {}
    if not path.exists():
        return m
    for line in path.read_text(encoding="utf-8", errors="ignore").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        m[k.strip()] = v.strip()
    return m


merged: dict[str, str] = {}
for src in [
    Path("/mnt/c/Users/Admin/.config/scrape-kit/env"),
    Path("/mnt/c/Users/Admin/.config/scrape-kit/app.env"),
    Path("/mnt/c/Users/Admin/projects/scrape-kit/.env"),
]:
    merged.update(load(src))

hub = Path("/home/zam/workspace/social-hub/.env")
out = load(hub)
picked = 0
for k in wanted:
    if merged.get(k):
        out[k] = merged[k]
        picked += 1

if out.get("AIRTABLE_TOKEN") and not out.get("AIRTABLE_API_KEY"):
    out["AIRTABLE_API_KEY"] = out["AIRTABLE_TOKEN"]
    picked += 1

hub.write_text("\n".join(f"{k}={v}" for k, v in out.items()) + "\n", encoding="utf-8")
print(f"picked={picked}")
print(f"hub_keys={len(out)}")
for k in wanted + ["AIRTABLE_API_KEY"]:
    print(("SET" if out.get(k) else "MISS"), k)
