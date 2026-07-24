import type { PlayerId } from "../../../shared/types";
import { COMMUNITY_CARD_COUNT } from "../../../shared/types";
import type { UiState } from "../state/reducer";
import { fmtChips } from "../lib/format";
import { CardSlot, PlayingCard } from "./PlayingCard";
import { Seat } from "./Seat";

interface Props {
  state: UiState;
}

export function Table({ state }: Props) {
  const record = state.lastRecord;
  const winners = new Set<PlayerId>(record?.winners ?? []);
  const community = state.communityCards;
  const missing = Math.max(0, COMMUNITY_CARD_COUNT - community.length);

  return (
    <div className="table">
      <div className="felt">
        <div className="felt__glow" aria-hidden="true" />

        <div className="board">
          <div className="board__pot">
            <span className="board__pot-label">POT</span>
            <span className="board__pot-value mono" key={state.pot}>
              {fmtChips(state.pot)}
            </span>
          </div>

          <div className="board__cards">
            {community.map((code, i) => (
              <PlayingCard key={`${code}-${i}`} code={code} index={i} size="lg" />
            ))}
            {Array.from({ length: missing }, (_, i) => (
              <CardSlot key={`slot-${i}`} />
            ))}
          </div>

          <div className="board__meta mono">
            {record ? (
              <span className="board__result">
                Hand {record.handId} · won by{" "}
                {record.winners
                  .map(
                    (id) =>
                      state.players.find((p) => p.id === id)?.name ?? id,
                  )
                  .join(" & ")}
                {record.showdown.length > 1 ? " · showdown" : " · uncontested"}
              </span>
            ) : state.handId > 0 ? (
              <span className="board__result">Hand {state.handId} in progress</span>
            ) : (
              <span className="board__result board__result--idle">
                Table ready
              </span>
            )}
          </div>
        </div>

        <div className="seats">
          {state.players.map((player) => (
            <Seat
              key={player.id}
              player={player}
              chips={state.chips[player.id]}
              strategy={state.strategies[player.id]}
              holeCards={state.holeCards[player.id] ?? []}
              isDealer={state.dealer === player.id}
              folded={state.folded[player.id]}
              lastAction={
                state.lastAction?.playerId === player.id
                  ? state.lastAction
                  : null
              }
              chipDelta={record ? (record.chipDeltas[player.id] ?? 0) : null}
              isWinner={winners.has(player.id)}
              handName={record?.handNames[player.id]}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
