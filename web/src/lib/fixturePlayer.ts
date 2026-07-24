import type { TimedEvent, TournamentEvent } from "../../../shared/types";

const MIN_GAP_MS = 220;
const MAX_GAP_MS = 3000;

/**
 * Client-side replay of a recorded fixture. Preserves the original relative
 * pacing but clamps the gaps so a 12-second LLM call does not stall the room.
 */
export class FixturePlayer {
  private index = 0;
  private timer: number | null = null;
  private running = false;
  private speed = 1;

  constructor(
    private readonly events: TimedEvent[],
    private readonly emit: (event: TournamentEvent) => void,
  ) {}

  get finished(): boolean {
    return this.index >= this.events.length;
  }

  setSpeed(speed: number): void {
    this.speed = speed > 0 ? speed : 1;
  }

  start(): void {
    if (this.running || this.finished) return;
    this.running = true;
    this.schedule(this.index === 0 ? 0 : this.gapFor(this.index));
  }

  pause(): void {
    this.running = false;
    this.clear();
  }

  stop(): void {
    this.running = false;
    this.clear();
    this.index = this.events.length;
  }

  private clear(): void {
    if (this.timer !== null) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private gapFor(index: number): number {
    const current = this.events[index];
    if (!current) return 0;
    const previous = index > 0 ? this.events[index - 1] : null;
    const raw = previous ? current.offsetMs - previous.offsetMs : 0;
    const clamped = Math.min(Math.max(raw, MIN_GAP_MS), MAX_GAP_MS);
    return clamped / this.speed;
  }

  private schedule(delay: number): void {
    this.clear();
    this.timer = window.setTimeout(() => {
      this.timer = null;
      if (!this.running) return;
      const next = this.events[this.index];
      if (!next) {
        this.running = false;
        return;
      }
      this.index += 1;
      this.emit(next.event);
      if (this.finished) {
        this.running = false;
        return;
      }
      this.schedule(this.gapFor(this.index));
    }, Math.max(0, delay));
  }
}
