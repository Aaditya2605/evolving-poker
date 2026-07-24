import type {
  Fixture,
  TournamentEvent,
  TraceMessage,
} from "../../../shared/types";

const EVENT_TYPES = new Set([
  "tournament_start",
  "hand_start",
  "action",
  "hand_end",
  "evolution",
  "metrics",
  "tournament_end",
]);

export type StreamMode = "live" | "replay" | "offline";

export type InboundMessage =
  | { kind: "event"; event: TournamentEvent }
  | { kind: "mode"; mode: StreamMode }
  | { kind: "unknown" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asMode(value: unknown): StreamMode | null {
  return value === "live" || value === "replay" || value === "offline"
    ? value
    : null;
}

/**
 * The socket is a trust boundary: everything arrives as unknown and is narrowed
 * here so the rest of the app only ever sees well-typed TournamentEvents.
 */
export function parseInbound(raw: unknown): InboundMessage {
  if (typeof raw !== "string") return { kind: "unknown" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { kind: "unknown" };
  }

  if (!isRecord(parsed) || typeof parsed.type !== "string") {
    return { kind: "unknown" };
  }

  if (parsed.type === "mode" || parsed.type === "hello") {
    const mode = asMode(parsed.mode);
    return mode ? { kind: "mode", mode } : { kind: "unknown" };
  }

  if (EVENT_TYPES.has(parsed.type)) {
    return { kind: "event", event: parsed as unknown as TournamentEvent };
  }

  return { kind: "unknown" };
}

export function isTournamentEventLike(value: unknown): value is TournamentEvent {
  return isRecord(value) && typeof value.type === "string" && EVENT_TYPES.has(value.type);
}

export function coerceFixture(value: unknown): Fixture | null {
  if (!isRecord(value) || !Array.isArray(value.events)) return null;

  const events = value.events
    .map((entry): { offsetMs: number; event: TournamentEvent } | null => {
      if (!isRecord(entry)) return null;
      const event = entry.event;
      if (!isTournamentEventLike(event)) return null;
      const offsetMs =
        typeof entry.offsetMs === "number" && Number.isFinite(entry.offsetMs)
          ? entry.offsetMs
          : 0;
      return { offsetMs, event };
    })
    .filter((entry): entry is { offsetMs: number; event: TournamentEvent } =>
      entry !== null,
    );

  if (events.length === 0) return null;

  const trace: TraceMessage[] = Array.isArray(value.trace)
    ? (value.trace as TraceMessage[])
    : [];

  return {
    version: 1,
    seed: typeof value.seed === "string" ? value.seed : "unknown",
    recordedAt: typeof value.recordedAt === "string" ? value.recordedAt : "",
    pioneerMode: typeof value.pioneerMode === "string" ? value.pioneerMode : "",
    events,
    trace,
  };
}

export const FIXTURE_URLS = [
  "/fixtures/demo.json",
  "/demo.json",
  "/api/fixture",
];

export async function loadFixture(): Promise<Fixture | null> {
  for (const url of FIXTURE_URLS) {
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) continue;
      const fixture = coerceFixture(await res.json());
      if (fixture) return fixture;
    } catch {
      // try the next candidate
    }
  }
  return null;
}
