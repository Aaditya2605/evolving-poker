import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { Fixture, TimedEvent, TournamentEvent } from "../../shared/types.js";
import type { Trace } from "./comm/trace.js";

/** Stamps each event with its ms offset from tournament_start. */
export class Recorder {
  private started = 0;
  readonly timed: TimedEvent[] = [];

  capture(event: TournamentEvent): void {
    const now = Date.now();
    if (this.timed.length === 0) this.started = now;
    this.timed.push({ offsetMs: now - this.started, event });
  }
}

export function writeFixture(
  path: string,
  seed: string,
  pioneerMode: string,
  timed: TimedEvent[],
  trace: Trace,
): string {
  const fixture: Fixture = {
    version: 1,
    seed,
    recordedAt: new Date().toISOString(),
    pioneerMode,
    events: timed,
    trace: trace.all(),
  };
  const full = resolve(path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, JSON.stringify(fixture, null, 2), "utf8");
  return full;
}

export function loadFixture(path: string): Fixture {
  const fixture = JSON.parse(readFileSync(resolve(path), "utf8")) as Fixture;
  if (fixture.version !== 1) throw new Error(`unsupported fixture version ${fixture.version}`);
  return fixture;
}

export interface ReplayOptions {
  speed?: number;
  onEvent: (event: TournamentEvent) => void;
  /** Awaited before each event — the pause control hangs off this. */
  gate?: () => Promise<void>;
  /** Read at each step so speed changes mid-replay take effect. */
  getSpeed?: () => number;
}

/**
 * Replays a recorded stream over the wire with its original pacing. The
 * frontend cannot distinguish this from a live tournament — which is exactly
 * why it is the demo's disaster fallback.
 */
export async function replayFixture(fixture: Fixture, opts: ReplayOptions): Promise<void> {
  let previous = 0;
  for (const timed of fixture.events) {
    if (opts.gate) await opts.gate();
    const speed = Math.max(0.1, opts.getSpeed?.() ?? opts.speed ?? 1);
    const wait = (timed.offsetMs - previous) / speed;
    previous = timed.offsetMs;
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    opts.onEvent(timed.event);
  }
}
