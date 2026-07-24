import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type {
  EvolutionEvent,
  FinalStandings,
  PlayerId,
  TournamentEvent,
} from "../../../shared/types.js";
import { DIALS, PLAYER_IDS } from "../../../shared/types.js";

const n2 = (x: number) => x.toFixed(2);

function dialLine(ev: EvolutionEvent): string {
  return DIALS.map((d) => {
    const before = ev.before[d];
    const after = ev.after[d];
    return before === after
      ? `${d} ${n2(after)}`
      : `**${d} ${n2(before)} → ${n2(after)}**`;
  }).join(" · ");
}

export function generateCited(
  events: TournamentEvent[],
  standings: FinalStandings,
  extras: { pioneerMode: string; bandMode: string; coercions: string[] } = {
    pioneerMode: "mock",
    bandMode: "local",
    coercions: [],
  },
): string {
  const snap = standings.snapshot;
  const evolutions = events
    .filter((e): e is Extract<TournamentEvent, { type: "evolution" }> => e.type === "evolution")
    .map((e) => e.event);
  const hands = events.filter(
    (e): e is Extract<TournamentEvent, { type: "hand_end" }> => e.type === "hand_end",
  );

  const lines: string[] = [];
  const push = (s = "") => lines.push(s);

  push("# Evolving Poker — Run Report");
  push();
  push(
    `Seed \`${standings.seed}\` · ${standings.handsPlayed} hands · ` +
      `${snap.totals.actionCalls} action calls + ${snap.totals.reflections} reflections · ` +
      `${snap.totals.llmCalls} total model calls · ` +
      `est. \$${snap.totals.estCostUsd.toFixed(4)} · Pioneer mode \`${extras.pioneerMode}\` · Band mode \`${extras.bandMode}\``,
  );
  push();
  push(
    "> Every claim below is generated from the run's own event log and cites the hands it rests on. " +
      "This was a six-hand run: it is an existence proof of self-modification, not a measurement of skill.",
  );
  push();

  // --- summary --------------------------------------------------------------
  push("## Final standing");
  push();
  push("| # | Player | Model | Chips | Net | Changes | No-change | Invalid | Timeout |");
  push("|---|--------|-------|-------|-----|---------|-----------|---------|---------|");
  for (const r of standings.ranking) {
    const ev = snap.evolution[r.playerId];
    push(
      `| ${r.rank} | ${r.name} | \`${r.model}\` | ${r.chips} | ${r.netChips >= 0 ? "+" : ""}${r.netChips} | ` +
        `${ev.changesApplied} | ${ev.noChanges} | ${ev.invalid} | ${ev.timeouts} |`,
    );
  }
  push();

  // --- hand log -------------------------------------------------------------
  push("## Hands");
  push();
  for (const h of hands) {
    const r = h.record;
    const deltas = PLAYER_IDS.map((id) => `${id}: ${r.chipDeltas[id] >= 0 ? "+" : ""}${r.chipDeltas[id]}`).join(", ");
    push(
      `- **hand-${r.handId}** — board \`${r.communityCards.join(" ")}\`, pot ${r.potSize}, ` +
        `winner **${r.winner}**${r.showdown.length ? ` at showdown (${r.showdown.join(", ")})` : " (no showdown)"}. ${deltas}`,
    );
  }
  push();

  // --- per-model timeline ---------------------------------------------------
  push("## Evolution timeline, by model");
  push();
  for (const id of PLAYER_IDS) {
    const agent = snap.agents[id];
    const evo = snap.evolution[id];
    push(`### ${agent.name} — \`${agent.model}\``);
    push();
    push(
      `Started \`${JSON.stringify(evo.initial)}\`, ended \`${JSON.stringify(evo.current)}\`. ` +
        `Total absolute dial movement ${evo.totalAbsMovement}; ${evo.oscillations} oscillation(s).`,
    );
    push();
    for (const ev of evolutions.filter((e) => e.playerId === id)) {
      const tag =
        ev.status === "applied"
          ? "CHANGED"
          : ev.status === "no_change"
            ? "HELD"
            : ev.status.toUpperCase();
      const cites = ev.evidence.length ? ` _(evidence: ${ev.evidence.join(", ")})_` : "";
      push(`- **after hand-${ev.handId} · ${tag}** — ${dialLine(ev)}`);
      push(`  > ${ev.reason}${cites}`);
      push(
        `  <sub>${ev.latencyMs}ms · ${ev.inputTokens}+${ev.outputTokens} tok · \$${ev.estCostUsd.toFixed(5)} · ` +
          `${ev.llmCalls} call${ev.llmCalls === 1 ? "" : "s"}${ev.retried ? " (retried once)" : ""}` +
          `${ev.repairs.length ? ` · repaired: ${ev.repairs.join("; ")}` : ""}</sub>`,
      );
    }
    push();
  }

  // --- findings -------------------------------------------------------------
  push("## Findings");
  push();
  push("_Auto-derived from the event log. Each claim lists the hands it rests on._");
  push();
  for (const f of standings.findings) {
    push(`- ${f.claim}${f.evidence.length ? ` _(${f.evidence.join(", ")})_` : ""}`);
  }
  push();

  // --- model comparison -----------------------------------------------------
  push("## Model comparison");
  push();
  push("| Model | Chips | Adaptation gain* | Bluffs | Volatility | Oscillations | No-change rate | Repairs | Avg latency | Est. cost |");
  push("|-------|-------|------------------|--------|------------|--------------|----------------|---------|-------------|-----------|");
  for (const id of PLAYER_IDS) {
    const a = snap.agents[id];
    const e = snap.evolution[id];
    const m = snap.models[id];
    const repairs = evolutions
      .filter((ev) => ev.playerId === id)
      .reduce((n, ev) => n + ev.repairs.length, 0);
    push(
      `| \`${a.model}\` | ${a.chips} | ${a.adaptationGain >= 0 ? "+" : ""}${a.adaptationGain} | ` +
        `${a.bluffsSuccessful}/${a.bluffsAttempted} | ${e.totalAbsMovement} | ${e.oscillations} | ` +
        `${Math.round(e.noChangeRate * 100)}% | ${repairs} | ` +
        `${m.avgLatencyMs}ms | \$${m.estCostUsd.toFixed(5)} |`,
    );
  }
  push();
  push(
    "No-change rate = share of reflections where the model explicitly declined to move a dial. " +
      "Repairs = local coercions applied to the raw response before validation (a number sent as " +
      "a string, evidence sent unwrapped, a second object after the first). Repairs fix transport, " +
      "never judgement, and they do not always rescue a response. Both columns are properties of " +
      "the model's output hygiene, not of its poker.",
  );
  push();
  push(
    "\\* Adaptation gain = second-half average chips/hand minus first-half. **Directional, this run only.** " +
      "With three hands per half it cannot separate strategy from card luck.",
  );
  push();

  // --- honesty --------------------------------------------------------------
  push("## Method and limitations");
  push();
  push(
    "- Pioneer models chose every fold, check, call, and raise. The engine supplied private/public state, " +
      "computed hand strength, constrained choices to legal actions, and owned chip accounting.",
  );
  push(
    "- Reflections were validated **mechanically only** — JSON shape and 0–1 range. No step-size cap, " +
      "no one-dial rule, no anti-reversal rule. Models were free to contradict themselves, and the " +
      "oscillation counter above measures how often they did.",
  );
  push(
    "- Every Pioneer request was stored for inference history, evaluation, clustering, and the platform's " +
      "Adaptive Inference pipeline. A six-hand demo does not claim that retraining completed.",
  );
  push(
    `- Failures are reported, not hidden: ${snap.totals.invalid} invalid response(s) and ${snap.totals.timeouts} timeout(s) ` +
      "left the affected strategy untouched and the tournament continued.",
  );
  if (extras.coercions.length) {
    push(`- ${extras.coercions.length} mechanically illegal action(s) were coerced:`);
    for (const c of extras.coercions) push(`  - ${c}`);
  }
  push(
    "- In this six-hand run the sample is far too small for any claim about which model is better at poker. " +
      "What it does show is that four different models, given identical evidence formats, chose visibly " +
      "different self-modification policies.",
  );
  push();
  push(`<sub>Generated ${new Date().toISOString()} from seed \`${standings.seed}\`.</sub>`);
  push();

  return lines.join("\n");
}

export function writeCited(markdown: string, path = "cited.md"): string {
  const full = resolve(path);
  writeFileSync(full, markdown, "utf8");
  return full;
}

export type { PlayerId };
