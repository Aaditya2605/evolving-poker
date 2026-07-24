import type { ConnectionState } from "../hooks/useTournamentStream";
import type { StreamMode } from "../lib/protocol";
import { fmtCost } from "../lib/format";

const SPEEDS = [0.5, 1, 2, 4];

interface Props {
  handId: number;
  totalHands: number;
  finished: boolean;
  llmCalls: number;
  costUsd: number;
  mode: StreamMode;
  connection: ConnectionState;
  paused: boolean;
  speed: number;
  onTogglePause: () => void;
  onSpeed: (speed: number) => void;
}

function badgeFor(
  mode: StreamMode,
  connection: ConnectionState,
): { label: string; tone: string } {
  if (connection === "connecting") return { label: "CONNECTING", tone: "idle" };
  if (connection === "reconnecting") return { label: "RECONNECTING", tone: "warn" };
  if (connection === "waiting") return { label: "NO SOURCE", tone: "warn" };
  if (mode === "offline") return { label: "OFFLINE REPLAY", tone: "offline" };
  if (mode === "replay") return { label: "REPLAY", tone: "replay" };
  return { label: connection === "ended" ? "LIVE · COMPLETE" : "LIVE", tone: "live" };
}

export function Header({
  handId,
  totalHands,
  finished,
  llmCalls,
  costUsd,
  mode,
  connection,
  paused,
  speed,
  onTogglePause,
  onSpeed,
}: Props) {
  const badge = badgeFor(mode, connection);
  const handLabel = finished
    ? "TOURNAMENT COMPLETE"
    : handId > 0
      ? `Hand ${handId} of ${totalHands}`
      : "Awaiting first hand";

  return (
    <header className="header">
      <div className="header__brand">
        <h1 className="header__title">
          EVOLVING <span className="header__title-accent">POKER</span>
        </h1>
        <p className="header__tagline">
          Three models. One table. Strategy rewritten after every hand.
        </p>
      </div>

      <div className="header__center">
        <div className="header__hand mono">{handLabel}</div>
        <span className={`badge badge--${badge.tone}`}>
          <span className="badge__dot" />
          {badge.label}
        </span>
      </div>

      <div className="header__stats">
        <div className="stat">
          <span className="stat__label">LLM calls</span>
          <span className="stat__value mono">{llmCalls}</span>
        </div>
        <div className="stat">
          <span className="stat__label">Est. cost</span>
          <span className="stat__value mono">{fmtCost(costUsd)}</span>
        </div>
      </div>

      <div className="header__controls">
        <button
          type="button"
          className="ctl ctl--primary"
          onClick={onTogglePause}
          aria-pressed={paused}
        >
          {paused ? "▶ Play" : "⏸ Pause"}
        </button>
        <div className="ctl-group" role="group" aria-label="Playback speed">
          {SPEEDS.map((value) => (
            <button
              key={value}
              type="button"
              className={`ctl ctl--speed${speed === value ? " is-active" : ""}`}
              onClick={() => onSpeed(value)}
              aria-pressed={speed === value}
            >
              {value}×
            </button>
          ))}
        </div>
      </div>
    </header>
  );
}
