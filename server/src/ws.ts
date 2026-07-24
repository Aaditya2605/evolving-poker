import type { Server } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import type { TournamentEvent } from "../../shared/types.js";

export interface Controls {
  paused: boolean;
  speed: number;
}

/**
 * Broadcasts the event stream and replays the backlog to every new client, so
 * a spectator joining mid-tournament sees the whole run. Live, fixture-replay
 * and offline modes all present the identical stream.
 */
export class Broadcaster {
  private wss: WebSocketServer;
  private clients = new Set<WebSocket>();
  private history: TournamentEvent[] = [];
  readonly controls: Controls = { paused: false, speed: 1 };
  private waiters: (() => void)[] = [];
  /** Nothing in TournamentEvent distinguishes a live run from a replay, so the
   *  UI's LIVE/REPLAY badge is driven by this out-of-band hello frame. */
  mode: "live" | "replay" | "idle" = "idle";

  constructor(server: Server, path = "/ws") {
    this.wss = new WebSocketServer({ server, path });
    this.wss.on("connection", (socket) => {
      this.clients.add(socket);
      socket.send(JSON.stringify({ type: "mode", mode: this.mode }));
      for (const e of this.history) socket.send(JSON.stringify(e));
      socket.on("message", (data) => this.onControl(String(data)));
      socket.on("close", () => this.clients.delete(socket));
      socket.on("error", () => this.clients.delete(socket));
    });
  }

  private onControl(raw: string): void {
    let msg: { type?: string; action?: string; value?: number };
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (msg.type !== "control") return;
    if (msg.action === "pause") this.controls.paused = true;
    if (msg.action === "play") this.controls.paused = false;
    if (msg.action === "speed" && typeof msg.value === "number") {
      this.controls.speed = Math.max(0.1, Math.min(8, msg.value));
    }
    if (!this.controls.paused) this.release();
  }

  private release(): void {
    const waiting = this.waiters.splice(0);
    for (const w of waiting) w();
  }

  /** Await this between hands (live) or before each event (replay). */
  gate = async (): Promise<void> => {
    while (this.controls.paused) {
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
  };

  publish(event: TournamentEvent): void {
    this.history.push(event);
    this.send(event);
  }

  private send(frame: unknown): void {
    const payload = JSON.stringify(frame);
    for (const c of this.clients) {
      if (c.readyState === c.OPEN) c.send(payload);
    }
  }

  setMode(mode: "live" | "replay" | "idle"): void {
    this.mode = mode;
    this.send({ type: "mode", mode });
  }

  reset(): void {
    this.history = [];
  }

  get clientCount(): number {
    return this.clients.size;
  }

  close(): void {
    this.release();
    for (const c of this.clients) c.close();
    this.wss.close();
  }
}
