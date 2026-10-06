declare class Fetcher {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

declare class ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

declare module "cloudflare:workers" {
  export class WorkflowEntrypoint<Env = unknown, Params = unknown> {
    env: Env;
  }
  export type WorkflowEvent<T> = { payload: T };
  export type WorkflowStep = {
    do<T>(
      name: string,
      options: unknown,
      callback: () => Promise<T>,
    ): Promise<T>;
  };
}
