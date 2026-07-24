import { useEffect, useRef } from "react";
import type {
  PlayerId,
  PlayerState,
  Strategy,
  TraceMessage,
} from "../../../shared/types";
import { fmtChips } from "../lib/format";
import { accentStyle } from "../lib/style";

/**
 * THE AGENT WIRE — the Band message bus rendered as conversation.
 *
 * Same data as the "Message trace" drawer, but live, human-readable, and
 * impossible to miss: dealer requests, agent actions, hand results, and each
 * model narrating its own strategy rewrite in first person. This panel is the
 * demo's answer to "what am I looking at?" — you are watching agents talk,
 * then watching them change their minds.
 */

interface Props {
  wire: TraceMessage[];
  players: PlayerState[];
}

interface TurnRequestPayload {
  handId: number;
  potSize: number;
  toCall: number;
  canRaise: boolean;
  raiseAmount: number;
  myChips: number;
}
interface TurnActionPayload {
  handId: number;
  action: string;
  amount: number;
  potAfter: number;
}
interface HandSummaryPayload {
  handId: number;
  winner: PlayerId;
  potSize: number;
  showdown: PlayerId[];
  chipDeltas: Record<PlayerId, number>;
}
interface EvolutionPayload {
  handId: number;
  status: "applied" | "no_change" | "invalid" | "timeout";
  before: Strategy;
  after: Strategy;
  reason: string;
  evidence: string[];
}

const DIAL_LABEL: Record<keyof Strategy, string> = {
  aggression: "aggr",
  bluffRate: "bluff",
  callThreshold: "call",
};

const STATUS_LABEL: Record<EvolutionPayload["status"], string> = {
  applied: "REWROTE ITSELF",
  no_change: "HELD",
  invalid: "INVALID REPLY",
  timeout: "TIMED OUT",
};

export function BandWire({ wire, players }: Props) {
  const feedRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = feedRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [wire.length]);

  const byId = (id: string): PlayerState | undefined =>
    players.find((p) => p.id === id);

  // A seat is "deciding" between its turn_request and its turn_action.
  const pending = new Set<string>();
  for (const m of wire) {
    if (m.kind === "turn_request" && m.to !== "all" && m.to !== "dealer") {
      pending.add(m.to);
    }
    if (m.kind === "turn_action" && m.from !== "dealer") pending.delete(m.from);
    if (m.kind === "hand_summary") pending.clear();
  }

  return (
    <section className="wire">
      <header className="wire__head">
        <div>
          <h2 className="wire__title">AGENT WIRE</h2>
          <p className="wire__sub">
            dealer + 3 signed identities · routed via <b>BAND</b> · every
            message logged
          </p>
        </div>
        <div className="wire__count mono">{wire.length} msgs</div>
      </header>

      <div className="wire__feed" ref={feedRef}>
        {wire.length === 0 ? (
          <div className="wire__empty">
            Waiting for the table to open — dealer speaks first.
          </div>
        ) : null}

        {wire.map((m) => {
          const key = `w${m.seq}`;

          if (m.kind === "turn_request") {
            const p = m.payload as TurnRequestPayload;
            const who = byId(String(m.to));
            return (
              <div className="wire__row wire__row--dealer" key={key}>
                <span className="wire__tag">DEALER</span>
                <span className="wire__txt">
                  <b style={who ? { color: who.color } : undefined}>
                    {who?.name ?? m.to}
                  </b>
                  , your action — pot {fmtChips(p.potSize)},{" "}
                  {p.toCall > 0 ? `${fmtChips(p.toCall)} to call` : "check is free"}
                  .
                </span>
              </div>
            );
          }

          if (m.kind === "turn_action") {
            const p = m.payload as TurnActionPayload;
            const who = byId(String(m.from));
            if (!who) return null;
            const verb =
              p.action === "raise"
                ? `Raise ${fmtChips(p.amount)}.`
                : p.action === "call"
                  ? `Call ${fmtChips(p.amount)}.`
                  : p.action === "check"
                    ? "Check."
                    : "Fold.";
            return (
              <div
                className="wire__row wire__row--agent"
                style={accentStyle(who.color)}
                key={key}
              >
                <span className="wire__tag wire__tag--agent">{who.name}</span>
                <span className="wire__txt">{verb}</span>
              </div>
            );
          }

          if (m.kind === "hand_summary") {
            const p = m.payload as HandSummaryPayload;
            const who = byId(p.winner);
            return (
              <div className="wire__row wire__row--summary" key={key}>
                <span className="wire__rule" />
                <span className="wire__txt">
                  HAND {p.handId} ·{" "}
                  <b style={who ? { color: who.color } : undefined}>
                    {who?.name ?? p.winner}
                  </b>{" "}
                  wins {fmtChips(p.potSize)}
                  {p.showdown.length > 0 ? " at showdown" : " — everyone folded"}
                </span>
                <span className="wire__rule" />
              </div>
            );
          }

          if (m.kind === "evolution_event") {
            const p = m.payload as EvolutionPayload;
            const who = byId(String(m.from));
            if (!who) return null;
            const deltas = (
              Object.keys(DIAL_LABEL) as (keyof Strategy)[]
            ).filter((k) => p.before[k] !== p.after[k]);
            return (
              <div
                className={`wire__evo wire__evo--${p.status}`}
                style={accentStyle(who.color)}
                key={key}
              >
                <div className="wire__evohead">
                  <span className="wire__tag wire__tag--agent">{who.name}</span>
                  <span className="wire__status">{STATUS_LABEL[p.status]}</span>
                  <span className="wire__hand mono">h{p.handId}</span>
                </div>
                <p className="wire__reason">“{p.reason}”</p>
                {deltas.length > 0 ? (
                  <div className="wire__deltas mono">
                    {deltas.map((k) => (
                      <span className="wire__delta" key={k}>
                        {DIAL_LABEL[k]} {p.before[k].toFixed(2)}
                        <i>→</i>
                        {p.after[k].toFixed(2)}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          }

          return null;
        })}

        {[...pending].map((id) => {
          const who = byId(id);
          if (!who) return null;
          return (
            <div
              className="wire__row wire__row--agent wire__row--typing"
              style={accentStyle(who.color)}
              key={`t${id}`}
            >
              <span className="wire__tag wire__tag--agent">{who.name}</span>
              <span className="wire__txt">
                deciding
                <span className="wire__dots">
                  <i />
                  <i />
                  <i />
                </span>
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
