import type {
  EvolutionEvent,
  EvolutionStatus,
  PlayerState,
} from "../../../shared/types";
import { DIALS } from "../../../shared/types";
import { dialLabel, fmtCost, fmtDial, fmtLatency } from "../lib/format";
import { accentStyle } from "../lib/style";

interface Props {
  event: EvolutionEvent;
  player: PlayerState | undefined;
  isNewest: boolean;
}

const STATUS_META: Record<
  EvolutionStatus,
  { pill: string; note: string | null }
> = {
  applied: { pill: "EVOLVED", note: null },
  no_change: {
    pill: "HELD",
    note: "held strategy — evidence insufficient",
  },
  invalid: {
    pill: "INVALID OUTPUT",
    note: "malformed response — previous strategy kept",
  },
  timeout: {
    pill: "TIMEOUT",
    note: "no response in time — previous strategy kept",
  },
};

export function EvolutionCard({ event, player, isNewest }: Props) {
  const meta = STATUS_META[event.status];
  const failed = event.status === "invalid" || event.status === "timeout";
  const color = player?.color ?? "#c9a24a";

  const className = [
    "evo",
    `evo--${event.status}`,
    isNewest ? "evo--newest" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <article className={className} style={accentStyle(color)}>
      <header className="evo__head">
        <span className="evo__dot" />
        <div className="evo__who">
          <span className="evo__name">{player?.name ?? event.playerId}</span>
          <span className="evo__model mono">{event.model}</span>
        </div>
        <div className="evo__right">
          <span className="evo__hand mono">after Hand {event.handId}</span>
          <span className={`evo__pill evo__pill--${event.status}`}>
            {meta.pill}
          </span>
        </div>
      </header>

      <div className="evo__dials">
        {DIALS.map((dial) => {
          const before = event.before[dial];
          const after = event.after[dial];
          const moved = Math.abs(after - before) > 1e-6;
          const delta = after - before;
          return (
            <div
              key={dial}
              className={`evo__dial${moved ? " is-moved" : " is-static"}`}
            >
              <span className="evo__dial-name">{dialLabel(dial)}</span>
              <span className="evo__dial-nums mono">
                <span className="evo__before">{fmtDial(before)}</span>
                <span className="evo__arrow">→</span>
                <span className="evo__after">{fmtDial(after)}</span>
              </span>
              <span
                className={`evo__dial-delta mono ${
                  delta > 0 ? "is-up" : delta < 0 ? "is-down" : ""
                }`}
              >
                {moved
                  ? `${delta > 0 ? "▲" : "▼"}${Math.abs(delta).toFixed(2)}`
                  : "—"}
              </span>
            </div>
          );
        })}
      </div>

      {meta.note ? <p className="evo__note">{meta.note}</p> : null}

      <p className={`evo__reason${failed ? " evo__reason--failure" : ""}`}>
        {event.reason || "(no reason returned)"}
      </p>

      {event.modelChanged ? (
        <p className="evo__note">
          Model migration: <span className="mono">{event.model}</span> →{" "}
          <span className="mono">{event.modelAfter}</span>
        </p>
      ) : null}

      {event.evidence.length > 0 ? (
        <div className="evo__evidence">
          {event.evidence.map((item, i) => (
            <span className="chip" key={`${item}-${i}`}>
              {item}
            </span>
          ))}
        </div>
      ) : null}

      <footer className="evo__foot mono">
        <span>{fmtLatency(event.latencyMs)}</span>
        <span>·</span>
        <span>{fmtCost(event.estCostUsd)}</span>
        <span>·</span>
        <span>
          {event.inputTokens + event.outputTokens} tok
        </span>
        {typeof event.confidence === "number" ? (
          <>
            <span>·</span>
            <span>conf {event.confidence.toFixed(2)}</span>
          </>
        ) : null}
        {event.retried ? <span className="evo__retried">retried</span> : null}
      </footer>
    </article>
  );
}
