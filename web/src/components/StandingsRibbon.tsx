import type { FinalStandings, PlayerState } from "../../../shared/types";
import { fmtChips, fmtSigned } from "../lib/format";
import { accentStyle } from "../lib/style";

interface Props {
  standings: FinalStandings;
  players: PlayerState[];
}

export function StandingsRibbon({ standings, players }: Props) {
  const colorOf = (id: string) =>
    players.find((p) => p.id === id)?.color ?? "#c9a24a";

  return (
    <div className="ribbon">
      <span className="ribbon__label">FINAL</span>
      <div className="ribbon__rows">
        {standings.ranking.map((row) => (
          <div
            className="ribbon__row"
            key={row.playerId}
            style={accentStyle(colorOf(row.playerId))}
          >
            <span className="ribbon__rank mono">#{row.rank}</span>
            <span className="ribbon__name">{row.name}</span>
            <span className="ribbon__model mono">{row.model}</span>
            <span className="ribbon__chips mono">{fmtChips(row.chips)}</span>
            <span
              className={`ribbon__net mono ${row.netChips >= 0 ? "is-up" : "is-down"}`}
            >
              {fmtSigned(row.netChips)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
