import type { PlayerId, TraceKind } from "../../../shared/types.js";
import { PLAYER_IDS } from "../../../shared/types.js";
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

export class RealBandRouter implements BandRouter {
  readonly mode = "real";
  private pending: Promise<void>[] = [];

  constructor(private trace: Trace) {}

  send(
    from: "dealer" | PlayerId,
    to: "dealer" | PlayerId | "all",
    kind: TraceKind,
    payload: unknown,
  ): void {
    this.trace.append(from, to, kind, payload);
    if (from === "dealer" || to === "dealer") return;

    const recipients = (to === "all" ? PLAYER_IDS.filter((id) => id !== from) : [to]).filter(
      (id): id is PlayerId => id !== from,
    );
    if (recipients.length === 0) return;

    const sender = config.bandAgents[from];
    const mentions = recipients.map((id) => {
      const agent = config.bandAgents[id];
      return { id: agent.id, name: agent.handle, handle: agent.handle };
    });
    const content = `${recipients.map((id) => `@${config.bandAgents[id].handle}`).join(" ")} ${kind}: ${JSON.stringify(payload)}`;

    const request = fetch(
      `${config.bandBaseUrl}/chats/${encodeURIComponent(config.bandRoomId)}/messages`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": sender.key,
        },
        body: JSON.stringify({ message: { content, mentions } }),
      },
    )
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Band ${response.status}: ${(await response.text()).slice(0, 240)}`);
        }
      })
      .catch((error) => {
        console.warn(`[band] ${kind} from ${from} was not published: ${(error as Error).message}`);
      });
    this.pending.push(request);
  }

  async close(): Promise<void> {
    await Promise.all(this.pending);
  }
}

export function createRouter(trace: Trace): BandRouter {
  return config.bandConfigured ? new RealBandRouter(trace) : new LocalRouter(trace);
}
