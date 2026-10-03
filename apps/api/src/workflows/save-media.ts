import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers";
import { downloadCdnUrl, uploadToR2 } from "../lib/r2.js";

export type SaveMediaWorkflowParams = {
  fileUrl: string;
  objectKey?: string;
  mediaType?: string;
};

export type SaveMediaWorkflowResult = {
  ok: true;
  key: string;
  bytes: number;
  contentType: string;
  publicUrl: string;
};

/**
 * Proof that a Workflow can download media and store it on R2.
 * The step returns only the object reference. File bytes stay out of
 * Workflow state because a non-stream step result is capped at 1 MiB.
 */
export class SaveMediaWorkflow extends WorkflowEntrypoint<
  Record<string, unknown>,
  SaveMediaWorkflowParams
> {
  async run(
    event: WorkflowEvent<SaveMediaWorkflowParams>,
    step: WorkflowStep,
  ): Promise<SaveMediaWorkflowResult> {
    return step.do(
      "download-and-upload",
      {
        retries: { limit: 3, delay: "5 seconds", backoff: "exponential" },
        timeout: "10 minutes",
      },
      async () => {
        applyStringEnv(this.env);
        const fileUrl = event.payload?.fileUrl;
        if (!fileUrl) throw new Error("fileUrl required");

        const { buffer, contentType, bytes } = await downloadCdnUrl(fileUrl);
        const key =
          event.payload.objectKey ||
          `social-hub/workflow-test/${Date.now()}.bin`;
        const uploaded = await uploadToR2({
          key,
          body: buffer,
          contentType,
        });

        return {
          ok: true as const,
          key: uploaded.key,
          bytes,
          contentType,
          publicUrl: uploaded.publicUrl,
        };
      },
    );
  }
}

function applyStringEnv(env: Record<string, unknown>) {
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === "string") process.env[key] = value;
  }
  process.env.RUNTIME = "cloudflare";
}
