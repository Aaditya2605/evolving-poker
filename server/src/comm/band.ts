import type { PlayerId, TraceKind } from "../../../shared/types.js";
import { config } from "../config.js";
import { Trace } from "./trace.js";

export interface BandRouter {
  readonly mode: string;
  send(
    from: "dealer" | PlayerId,
    to: "dealer" | PlayerId | "all",
    kind: TraceKind,
    payload: unknown,
  ): void;
  close(): Promise<void>;
}

/**
 * Default. Dealer↔player messages are routed in-process; the trace is still
 * written in the exact Band record shape. The demo never depends on Band being
 * up — that is the whole point of this split.
 */
export class LocalRouter implements BandRouter {
  readonly mode = "local";
  constructor(private trace: Trace) {}

  send(
    from: "dealer" | PlayerId,
    to: "dealer" | PlayerId | "all",
    kind: TraceKind,
    payload: unknown,
  ): void {
    this.trace.append(from, to, kind, payload);
  }

  async close(): Promise<void> {}
}

export function createRouter(trace: Trace): BandRouter {
  if (config.bandConfigured) {
    console.warn(
      "[band] credentials found, but real three-agent routing is not implemented; using the local trace.",
    );
  }
  return new LocalRouter(trace);
}
