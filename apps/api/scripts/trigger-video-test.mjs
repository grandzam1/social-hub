import { configure, runs, tasks } from "@trigger.dev/sdk";

const secretKey = process.env.TRIGGER_SECRET_KEY;
if (!secretKey) throw new Error("TRIGGER_SECRET_KEY is not set");
configure({ secretKey });

const handle = await tasks.trigger("save-video-to-r2", {
  fileUrl: "https://samplelib.com/mp4/sample-15s.mp4",
  objectKey: "social-hub/trigger-test/sample-15s.mp4",
});

console.log(`run ${handle.id} queued`);
const run = await runs.poll(handle.id, { pollIntervalMs: 2000 });
console.log(JSON.stringify({
  id: run.id,
  status: run.status,
  output: run.output,
  error: run.error,
}, null, 2));
