import type { PlayerId, TraceKind, TraceMessage } from "../../../shared/types.js";

/**
 * Band-shaped message log. Written in BOTH local and real Band mode so the
 * trace is identical either way — which is what makes swapping in the real SDK
 * a no-op for every consumer (UI drawer, audit pack, judges).
 */
export class Trace {
  private messages: TraceMessage[] = [];
  private seq = 0;
  private listeners: ((m: TraceMessage) => void)[] = [];
  /** Injectable so recorded fixtures are byte-stable in tests. */
  now: () => number = () => Date.now();

  append(
    from: "dealer" | PlayerId,
    to: "dealer" | PlayerId | "all",
    kind: TraceKind,
    payload: unknown,
  ): TraceMessage {
    const msg: TraceMessage = { ts: this.now(), seq: this.seq++, from, to, kind, payload };
    this.messages.push(msg);
    for (const l of this.listeners) l(msg);
    return msg;
  }

  onMessage(fn: (m: TraceMessage) => void): void {
    this.listeners.push(fn);
  }

  all(): TraceMessage[] {
    return this.messages.slice();
  }

  /** Rehydrate from a recorded fixture so replay exposes the same trace. */
  load(messages: TraceMessage[]): void {
    this.messages = messages.slice();
    this.seq = messages.length;
  }

  clear(): void {
    this.messages = [];
    this.seq = 0;
  }

  toJSON(): TraceMessage[] {
    return this.all();
  }
}
