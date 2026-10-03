import type { SaveMediaInput } from "./save-media.js";

const TRIGGER_API = "https://api.trigger.dev";

export async function queueMediaSaves(
  items: SaveMediaInput[],
): Promise<{ id: string; runCount: number }> {
  const key = process.env.TRIGGER_SECRET_KEY;
  if (!key) throw new Error("Missing env var: TRIGGER_SECRET_KEY");
  if (!items.length) throw new Error("No media to queue");

  const res = await fetch(`${TRIGGER_API}/api/v2/tasks/batch`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      items: items.map((payload) => ({
        task: "save-media-to-r2",
        payload,
      })),
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `Trigger.dev queue failed ${res.status}: ${body.slice(0, 300)}`,
    );
  }
  return (await res.json()) as { id: string; runCount: number };
}
