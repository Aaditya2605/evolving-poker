import type { PlayerState, Strategy } from "../../../shared/types";
import type { ResolvedAction } from "../state/reducer";
import { DialBars } from "./DialBars";
import { PlayingCard } from "./PlayingCard";
import { fmtChips, fmtSigned } from "../lib/format";
import { accentStyle } from "../lib/style";

interface Props {
  player: PlayerState;
  chips: number;
  strategy: Strategy;
  holeCards: string[];
  isDealer: boolean;
  folded: boolean;
  lastAction: ResolvedAction | null;
  chipDelta: number | null;
  isWinner: boolean;
  handName?: string;
}

function actionLabel(action: ResolvedAction): string {
  switch (action.action) {
    case "raise":
      return `RAISE ${action.amount}`;
    case "call":
      return `CALL ${action.amount}`;
    case "check":
      return "CHECK";
    case "fold":
      return "FOLD";
    default:
      return "";
  }
}

export function Seat({
  player,
  chips,
  strategy,
  holeCards,
  isDealer,
  folded,
  lastAction,
  chipDelta,
  isWinner,
  handName,
}: Props) {
  const className = [
    "seat",
    folded ? "seat--folded" : "",
    isWinner ? "seat--winner" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <section className={className} style={accentStyle(player.color)}>
      <div className="seat__accent" />

      <header className="seat__head">
        <div className="seat__identity">
          <h2 className="seat__name">{player.name}</h2>
          <div className="seat__model" title={player.model}>
            <span className="seat__model-tag">MODEL</span>
            <span className="seat__model-id mono">{player.model}</span>
          </div>
        </div>
        {isDealer ? (
          <span className="dealer-button" title="Dealer button">
            D
          </span>
        ) : null}
      </header>

      <div className="seat__cards">
        {holeCards.length > 0 ? (
          holeCards.map((code, i) => (
            <PlayingCard
              key={`${code}-${i}`}
              code={code}
              index={i}
              size="md"
              dimmed={folded}
            />
          ))
        ) : (
          <div className="seat__cards-empty">—</div>
        )}
        {lastAction ? (
          <span
            key={lastAction.seq}
            className={`action-badge action-badge--${lastAction.action}${
              lastAction.isBluff ? " action-badge--bluff" : ""
            }`}
          >
            {actionLabel(lastAction)}
            {lastAction.isBluff ? <em>bluff</em> : null}
          </span>
        ) : null}
      </div>

      {lastAction?.agent ? (
        <p className="seat__agent-reason" title={lastAction.agent.reason}>
          “{lastAction.agent.reason}”
        </p>
      ) : null}

      <div className="seat__chips">
        <span className="seat__chips-value mono">{fmtChips(chips)}</span>
        <span className="seat__chips-label">chips</span>
        {chipDelta !== null && chipDelta !== 0 ? (
          <span
            className={`seat__delta mono ${chipDelta > 0 ? "is-up" : "is-down"}`}
          >
            {fmtSigned(chipDelta)}
          </span>
        ) : null}
      </div>

      {handName ? <div className="seat__handname">{handName}</div> : null}

      <DialBars strategy={strategy} color={player.color} compact />
    </section>
  );
}
