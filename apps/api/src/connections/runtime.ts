import type { ConnectionsEnv } from "./index.js";

let current: ConnectionsEnv = {};

/** Worker entry copies bindings here so Node-style libs can call getConnection. */
export function setConnectionsEnv(env: ConnectionsEnv) {
  current = env;
}

export function connectionsEnv(): ConnectionsEnv {
  return current;
}
