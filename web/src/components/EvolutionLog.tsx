import { useMemo } from "react";
import type { EvolutionEvent, PlayerState } from "../../../shared/types";
import { EvolutionCard } from "./EvolutionCard";

interface Props {
  events: EvolutionEvent[];
  players: PlayerState[];
  waiting: boolean;
}

export function EvolutionLog({ events, players, waiting }: Props) {
  const byId = useMemo(() => {
    const map = new Map<string, PlayerState>();
    for (const player of players) map.set(player.id, player);
    return map;
  }, [players]);

  const ordered = useMemo(() => events.slice().reverse(), [events]);
  const applied = events.filter((e) => e.status === "applied").length;
  const failures = events.filter(
    (e) => e.status === "invalid" || e.status === "timeout",
  ).length;

  return (
    <section className="evolog">
      <header className="evolog__head">
        <div>
          <h2 className="evolog__title">EVOLUTION LOG</h2>
          <p className="evolog__sub">
            newest first · every call shown, including failures
          </p>
        </div>
        <div className="evolog__counts mono">
          <span title="strategy changes applied">{applied} applied</span>
          <span title="calls that failed">{failures} failed</span>
          <span title="total reflections">{events.length} total</span>
        </div>
      </header>

      <div className="evolog__feed">
        {ordered.length === 0 ? (
          <div className="evolog__empty">
            {waiting
              ? "Waiting for the first hand to complete. Each model reflects after every hand."
              : "No reflections yet."}
          </div>
        ) : (
          ordered.map((event, i) => (
            <EvolutionCard
              key={`${event.handId}-${event.playerId}-${events.length - i}`}
              event={event}
              player={byId.get(event.playerId)}
              isNewest={i === 0}
            />
          ))
        )}
      </div>
    </section>
  );
}
