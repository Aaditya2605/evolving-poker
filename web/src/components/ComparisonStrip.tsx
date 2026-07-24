import type {
  EvolutionEvent,
  MetricsSnapshot,
  PlayerId,
  PlayerState,
} from "../../../shared/types";
import { DIALS } from "../../../shared/types";
import { fmtChips, fmtCost, fmtLatency, fmtSigned } from "../lib/format";
import { accentStyle } from "../lib/style";

interface Props {
  players: PlayerState[];
  chips: Record<PlayerId, number>;
  metrics: MetricsSnapshot | null;
  evolutions: EvolutionEvent[];
}

interface Row {
  key: string;
  label: string;
  hint?: string;
  values: string[];
  emphasise?: boolean;
}

function fallbackVolatility(events: EvolutionEvent[]): number {
  return events.reduce((sum, event) => {
    if (event.status !== "applied") return sum;
    return (
      sum +
      DIALS.reduce(
        (inner, dial) =>
          inner + Math.abs(event.after[dial] - event.before[dial]),
        0,
      )
    );
  }, 0);
}

export function ComparisonStrip({
  players,
  chips,
  metrics,
  evolutions,
}: Props) {
  const perPlayer = players.map((player) => {
    const own = evolutions.filter((e) => e.playerId === player.id);
    const agent = metrics?.agents[player.id];
    const evo = metrics?.evolution[player.id];
    const model = metrics?.models[player.id];

    const latency = model
      ? model.avgLatencyMs
      : own.length
        ? own.reduce((s, e) => s + e.latencyMs, 0) / own.length
        : NaN;

    return {
      player,
      chips: chips[player.id],
      adaptationGain: agent ? agent.adaptationGain : null,
      bluffsAttempted: agent ? agent.bluffsAttempted : null,
      bluffsSuccessful: agent ? agent.bluffsSuccessful : null,
      bluffRate: agent ? agent.bluffSuccessRate : null,
      volatility: evo ? evo.totalAbsMovement : fallbackVolatility(own),
      noChanges: evo
        ? evo.noChanges
        : own.filter((e) => e.status === "no_change").length,
      oscillations: evo ? evo.oscillations : null,
      latency,
      cost: model
        ? model.estCostUsd
        : own.reduce((s, e) => s + e.estCostUsd, 0),
      failures: evo
        ? evo.invalid + evo.timeouts
        : own.filter((e) => e.status === "invalid" || e.status === "timeout")
            .length,
    };
  });

  const rows: Row[] = [
    {
      key: "chips",
      label: "Chips",
      values: perPlayer.map((p) => fmtChips(p.chips)),
      emphasise: true,
    },
    {
      key: "adaptation",
      label: "Adaptation gain",
      hint: "directional, this run only",
      values: perPlayer.map((p) =>
        p.adaptationGain === null ? "—" : fmtSigned(p.adaptationGain, 1),
      ),
    },
    {
      key: "bluff",
      label: "Bluff success",
      values: perPlayer.map((p) => {
        if (p.bluffsAttempted === null || p.bluffsSuccessful === null) return "—";
        if (p.bluffsAttempted === 0) return "0 / 0";
        const pct = Math.round((p.bluffRate ?? 0) * 100);
        return `${p.bluffsSuccessful} / ${p.bluffsAttempted} · ${pct}%`;
      }),
    },
    {
      key: "volatility",
      label: "Volatility",
      hint: "Σ |Δdial|",
      values: perPlayer.map((p) => p.volatility.toFixed(2)),
    },
    {
      key: "nochange",
      label: "No-change calls",
      values: perPlayer.map((p) => String(p.noChanges)),
    },
    {
      key: "osc",
      label: "Oscillations",
      values: perPlayer.map((p) =>
        p.oscillations === null ? "—" : String(p.oscillations),
      ),
    },
    {
      key: "failures",
      label: "Failed calls",
      values: perPlayer.map((p) => String(p.failures)),
    },
    {
      key: "latency",
      label: "Avg latency",
      values: perPlayer.map((p) => fmtLatency(p.latency)),
    },
    {
      key: "cost",
      label: "Est. cost",
      values: perPlayer.map((p) => fmtCost(p.cost)),
    },
  ];

  if (players.length === 0) {
    return (
      <section className="strip strip--empty">
        <p>Model comparison appears once the tournament starts.</p>
      </section>
    );
  }

  return (
    <section className="strip">
      <div className="strip__head">
        <div className="strip__corner">MODEL COMPARISON</div>
        {players.map((player) => (
          <div
            className="strip__model"
            key={player.id}
            style={accentStyle(player.color)}
          >
            <span className="strip__model-name">{player.name}</span>
            <span className="strip__model-id mono">{player.model}</span>
          </div>
        ))}
      </div>

      <div className="strip__rows">
        {rows.map((row) => (
          <div className="strip__row" key={row.key}>
            <div className="strip__label">
              {row.label}
              {row.hint ? (
                <span className="strip__hint">{row.hint}</span>
              ) : null}
            </div>
            {row.values.map((value, i) => (
              <div
                className={`strip__cell mono${row.emphasise ? " is-strong" : ""}`}
                key={`${row.key}-${players[i]?.id ?? i}`}
                style={accentStyle(players[i]?.color ?? "#c9a24a")}
              >
                {value}
              </div>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}
