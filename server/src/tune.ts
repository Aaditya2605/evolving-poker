import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { PlayerId } from "../../shared/types.js";
import { NEUTRAL_STRATEGY, PLAYER_IDS } from "../../shared/types.js";
import { initialPlayers, config } from "./config.js";
import { runTournament } from "./engine/tournament.js";
import { createAdapter } from "./evolution/pioneer.js";
import { setClosingBlock } from "./evolution/prompt.js";

const ROOT = resolve(import.meta.dirname, "..", "..");

/**
 * Prompt-tuning harness. The wording of the closing instruction block is the
 * only lever we have over how often a model declines to change — and its effect
 * is not predictable from reading it. This runs the same seeds under a candidate
 * wording and reports what actually changed.
 */
export interface TuneRow {
  playerId: PlayerId;
  model: string;
  runs: number;
  reflections: number;
  noChangeRate: number;
  /** Σ|Δdial| across all dials, divided by hands played. "drift per hand". */
  meanAbsMovementPerHand: number;
  oscillations: number;
  parseFailures: number;
  timeouts: number;
  repairs: number;
  llmCalls: number;
  meanFinalChips: number;
}

export interface TuneOptions {
  seeds: string[];
  /** Monte-Carlo hand strength instead of exact enumeration. Much faster. */
  samples?: number;
  promptVariant?: string | null;
}

export async function tune(opts: TuneOptions): Promise<TuneRow[]> {
  const acc = new Map<
    PlayerId,
    Omit<TuneRow, "noChangeRate" | "meanAbsMovementPerHand" | "meanFinalChips"> & {
      noChanges: number;
      absMovement: number;
      hands: number;
      chips: number;
    }
  >();

  for (const id of PLAYER_IDS) {
    acc.set(id, {
      playerId: id,
      model: config.models[id],
      runs: 0,
      reflections: 0,
      noChanges: 0,
      absMovement: 0,
      hands: 0,
      chips: 0,
      oscillations: 0,
      parseFailures: 0,
      timeouts: 0,
      repairs: 0,
      llmCalls: 0,
    });
  }

  for (const seed of opts.seeds) {
    const result = await runTournament({
      seed,
      players: initialPlayers(NEUTRAL_STRATEGY),
      adapter: createAdapter(0),
      strengthOptions: opts.samples !== undefined ? { samples: opts.samples } : undefined,
    });

    const snap = result.standings.snapshot;
    for (const id of PLAYER_IDS) {
      const a = acc.get(id)!;
      const evo = snap.evolution[id];
      const player = result.players.find((p) => p.id === id)!;
      a.runs += 1;
      a.hands += snap.handsPlayed;
      a.chips += player.chips;
      a.reflections += evo.updatesAttempted;
      a.noChanges += evo.noChanges;
      a.absMovement += evo.totalAbsMovement;
      a.oscillations += evo.oscillations;
      a.parseFailures += evo.invalid;
      a.timeouts += evo.timeouts;
      // NOT snap.models[id].calls — that counts reflections. Retries cost extra.
      a.llmCalls += player.strategyHistory.reduce((n, e) => n + e.llmCalls, 0);
      a.repairs += player.strategyHistory.reduce((n, e) => n + e.repairs.length, 0);
    }
    process.stderr.write(`  seed ${seed} done\n`);
  }

  const round3 = (n: number) => Math.round(n * 1000) / 1000;
  return PLAYER_IDS.map((id) => {
    const a = acc.get(id)!;
    return {
      playerId: a.playerId,
      model: a.model,
      runs: a.runs,
      reflections: a.reflections,
      noChangeRate: a.reflections === 0 ? 0 : round3(a.noChanges / a.reflections),
      meanAbsMovementPerHand: a.hands === 0 ? 0 : round3(a.absMovement / a.hands),
      oscillations: a.oscillations,
      parseFailures: a.parseFailures,
      timeouts: a.timeouts,
      repairs: a.repairs,
      llmCalls: a.llmCalls,
      meanFinalChips: a.runs === 0 ? 0 : Math.round(a.chips / a.runs),
    };
  });
}

// --- CLI -------------------------------------------------------------------

/** Accepts `1..20`, `1,5,9`, or a single value. Non-numeric seeds pass through. */
export function parseSeeds(spec: string): string[] {
  const range = spec.match(/^(\d+)\.\.(\d+)$/);
  if (range) {
    const from = Number(range[1]);
    const to = Number(range[2]);
    if (to < from) throw new Error(`bad --seeds range "${spec}": end is before start`);
    return Array.from({ length: to - from + 1 }, (_, i) => String(from + i));
  }
  return spec
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseFlags(argv: string[]): Record<string, string | boolean> {
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      flags[key] = next;
      i++;
    } else {
      flags[key] = true;
    }
  }
  return flags;
}

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + " ".repeat(n - s.length);
}
function padLeft(s: string, n: number): string {
  return s.length >= n ? s : " ".repeat(n - s.length) + s;
}

export function formatTable(rows: TuneRow[]): string {
  const head = [
    pad("model", 22),
    padLeft("no-chg", 7),
    padLeft("drift/hand", 11),
    padLeft("osc", 4),
    padLeft("fails", 6),
    padLeft("t/o", 4),
    padLeft("repairs", 8),
    padLeft("calls", 6),
    padLeft("chips", 7),
  ].join("  ");

  const body = rows.map((r) =>
    [
      pad(r.model, 22),
      padLeft(`${Math.round(r.noChangeRate * 100)}%`, 7),
      padLeft(r.meanAbsMovementPerHand.toFixed(3), 11),
      padLeft(String(r.oscillations), 4),
      padLeft(String(r.parseFailures), 6),
      padLeft(String(r.timeouts), 4),
      padLeft(String(r.repairs), 8),
      padLeft(String(r.llmCalls), 6),
      padLeft(String(r.meanFinalChips), 7),
    ].join("  "),
  );

  return [head, "-".repeat(head.length), ...body].join("\n");
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2));
  const spec = typeof flags.seeds === "string" ? flags.seeds : "1..20";
  const seeds = parseSeeds(spec);
  const samples = typeof flags.samples === "string" ? Number(flags.samples) : 120;
  const variantPath = typeof flags["prompt-variant"] === "string" ? flags["prompt-variant"] : null;

  let variantLabel = "default";
  if (variantPath) {
    // npm workspaces run us with cwd=server/, so a relative path from the repo
    // root would silently miss. Resolve against the root like index.ts does.
    const full = resolve(ROOT, variantPath);
    setClosingBlock(readFileSync(full, "utf8").trim());
    variantLabel = variantPath;
  }

  process.stderr.write(
    `Tuning over ${seeds.length} seed(s) [${spec}] · prompt: ${variantLabel} · ` +
      `Pioneer mode: ${config.pioneerMode} · strength samples: ${samples}\n`,
  );
  if (variantPath && config.pioneerMode !== "real") {
    process.stderr.write(
      "  NOTE: the mock adapter is scripted and ignores prompt wording. A variant\n" +
        "  only moves these numbers with PIONEER_MODE=real.\n",
    );
  }

  const rows = await tune({ seeds, samples, promptVariant: variantPath });

  console.log();
  console.log(formatTable(rows));
  console.log();
  console.log(
    "no-chg = share of reflections that declined to move a dial · drift/hand = mean Σ|Δdial| per hand",
  );
  console.log(
    "fails = responses still unparseable after one retry · repairs = local coercions applied before validation",
  );
  console.log("calls = adapter calls actually spent; exceeds reflections whenever a retry fired");
}

const invokedDirectly = process.argv[1]?.replace(/\\/g, "/").endsWith("/tune.ts");
if (invokedDirectly) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
