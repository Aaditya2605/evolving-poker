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

/**
 * Real Band routing. Wire this at the event ONLY after the tournament loop is
 * proven working locally. Every message is still written to the local trace, so
 * a Band outage degrades to LocalRouter behaviour rather than losing the log.
 *
 * TODO(event): replace the dynamic import + call below with the actual Band SDK
 * surface. Nothing outside this class needs to change.
 */
export class BandRouter_Real implements BandRouter {
  readonly mode = "band";
  private client: { publish: (m: unknown) => Promise<void>; close?: () => Promise<void> } | null =
    null;
  private ready: Promise<void>;

  constructor(private trace: Trace) {
    this.ready = this.connect();
  }

  private async connect(): Promise<void> {
    try {
      const mod = (await import(/* @vite-ignore */ "band-sdk" as string)) as any;
      this.client = await mod.connect({ apiKey: config.bandApiKey, room: config.bandRoom });
    } catch (e) {
      console.warn(
        `[band] SDK unavailable (${(e as Error).message}) — continuing with local routing; trace is unaffected.`,
      );
      this.client = null;
    }
  }

  send(
    from: "dealer" | PlayerId,
    to: "dealer" | PlayerId | "all",
    kind: TraceKind,
    payload: unknown,
  ): void {
    const msg = this.trace.append(from, to, kind, payload);
    void this.ready.then(() => this.client?.publish(msg).catch(() => {}));
  }

  async close(): Promise<void> {
    await this.ready;
    await this.client?.close?.();
  }
}

export function createRouter(trace: Trace): BandRouter {
  return config.bandMode === "real" ? new BandRouter_Real(trace) : new LocalRouter(trace);
}
