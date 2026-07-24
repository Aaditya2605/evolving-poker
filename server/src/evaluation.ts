import type {
  DialName,
  EvolutionEvent,
  FinalStandings,
  HandAction,
  HandRecord,
  PlayerId,
  TournamentEvent,
  TraceMessage,
} from "../../shared/types.js";
import { DIALS } from "../../shared/types.js";
import { annotateToCall } from "./engine/metrics.js";

type FollowThrough = "followed" | "diverged" | "unassessed";

export interface EvaluationProof {
  playerId: PlayerId;
  name: string;
  sourceHand: number;
  evidence: string[];
  change: string;
  observationHand: number | null;
  observation: string;
  followThrough: FollowThrough;
}

export interface EvaluationDashboard {
  seed: string;
  handsPlayed: number;
  verdict: {
    label: string;
    detail: string;
    level: "positive" | "neutral" | "warning";
  };
  coverage: {
    outcomesLinked: boolean;
    appliedChanges: number;
    comparableChanges: number;
    counterfactualAvailable: false;
    sample: "exploratory";
  };
  players: {
    playerId: PlayerId;
    name: string;
    model: string;
    outcomeLift: number;
    evidenceGrounding: number | null;
    behaviorFollowThrough: number | null;
    assessedChanges: number;
    stabilityScore: number;
    reliability: number;
    changes: number;
    modelMigrations: number;
    costUsd: number;
  }[];
  proofs: EvaluationProof[];
  pioneer: {
    inferenceIdsCaptured: number;
    decisionsLinkedToOutcomes: number;
    feedbackSubmitted: false;
    checkpointPromoted: false;
  };
  band: {
    playerEvents: number;
    dealerEvents: number;
  };
}

const round = (value: number, digits = 1) => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};
const clamp = (value: number) => Math.max(0, Math.min(100, value));

function evidenceGrounding(events: EvolutionEvent[]): number | null {
  const reviewable = events.filter((event) => event.status === "applied" || event.status === "no_change");
  if (!reviewable.length) return null;
  const grounded = reviewable.filter(
    (event) =>
      event.evidence.length > 0 &&
      event.evidence.every((ref) => {
        const match = /^hand-(\d+)$/.exec(ref);
        const hand = match ? Number(match[1]) : 0;
        return hand >= 1 && hand <= event.handId;
      }),
  ).length;
  return round((grounded / reviewable.length) * 100);
}

function largestDialChange(event: EvolutionEvent): { dial: DialName; delta: number } | null {
  const changed = DIALS.map((dial) => ({ dial, delta: event.after[dial] - event.before[dial] }))
    .filter(({ delta }) => delta !== 0)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  return changed[0] ?? null;
}

function actionLabel(action: HandAction & { toCall: number }): string {
  const amount = action.amount ? ` $${action.amount}` : "";
  return `${action.action}${amount}${action.toCall > 0 ? ` facing $${action.toCall}` : ""}`;
}

function assessChange(
  event: EvolutionEvent,
  records: HandRecord[],
): Pick<EvaluationProof, "observationHand" | "observation" | "followThrough"> {
  const change = largestDialChange(event);
  if (!change) {
    return {
      observationHand: null,
      observation: "Model changed, but no strategy dial moved.",
      followThrough: "unassessed",
    };
  }

  for (const record of records.filter((item) => item.handId > event.handId)) {
    const actions = annotateToCall(record.actions).filter((action) => action.playerId === event.playerId);
    let candidate: (HandAction & { toCall: number }) | undefined;
    let matched = false;

    if (change.dial === "aggression") {
      candidate = actions[0];
      if (candidate) matched = change.delta > 0 ? candidate.action === "raise" : candidate.action !== "raise";
    } else if (change.dial === "bluffRate" && record.handStrength[event.playerId] < 0.45) {
      candidate = actions[0];
      if (candidate) matched = change.delta > 0 ? candidate.isBluff : !candidate.isBluff;
    } else if (change.dial === "callThreshold") {
      candidate = actions.find((action) => action.toCall > 0);
      if (candidate) {
        matched =
          change.delta > 0
            ? candidate.action === "fold"
            : candidate.action === "call" || candidate.action === "raise";
      }
    }

    if (candidate) {
      return {
        observationHand: record.handId,
        observation: `Next comparable decision: ${actionLabel(candidate)}.`,
        followThrough: matched ? "followed" : "diverged",
      };
    }
  }

  return {
    observationHand: null,
    observation: "No later comparable decision occurred in this run.",
    followThrough: "unassessed",
  };
}

function proofFor(
  event: EvolutionEvent,
  name: string,
  records: HandRecord[],
): EvaluationProof {
  const changed = DIALS.filter((dial) => event.after[dial] !== event.before[dial])
    .map(
      (dial) =>
        `${dial} ${event.before[dial].toFixed(2)} → ${event.after[dial].toFixed(2)}`,
    )
    .join(" · ");
  const modelChange = event.modelChanged ? `model ${event.model} → ${event.modelAfter}` : "";
  return {
    playerId: event.playerId,
    name,
    sourceHand: event.handId,
    evidence: event.evidence,
    change: [changed, modelChange].filter(Boolean).join(" · ") || "No mechanical state change",
    ...assessChange(event, records),
  };
}

export function buildEvaluationDashboard(
  events: TournamentEvent[],
  standings: FinalStandings,
  trace: TraceMessage[] = [],
): EvaluationDashboard {
  const records = events
    .filter((event): event is Extract<TournamentEvent, { type: "hand_end" }> => event.type === "hand_end")
    .map((event) => event.record);
  const evolutions = events
    .filter((event): event is Extract<TournamentEvent, { type: "evolution" }> => event.type === "evolution")
    .map((event) => event.event);
  const actions = events.filter(
    (event): event is Extract<TournamentEvent, { type: "action" }> => event.type === "action",
  );

  const names = Object.fromEntries(
    standings.ranking.map((entry) => [entry.playerId, entry.name]),
  ) as Record<PlayerId, string>;
  const applied = evolutions.filter((event) => event.status === "applied");
  const proofs = applied.map((event) => proofFor(event, names[event.playerId], records));
  const assessed = proofs.filter((proof) => proof.followThrough !== "unassessed");
  const followed = assessed.filter((proof) => proof.followThrough === "followed").length;

  let verdict: EvaluationDashboard["verdict"];
  if (!applied.length) {
    verdict = {
      label: "No measurable adaptation in this run",
      detail: `${evolutions.length} reflections ran, but none changed strategy or model.`,
      level: "warning",
    };
  } else if (!assessed.length) {
    verdict = {
      label: `${applied.length} changes observed; follow-through is not yet testable`,
      detail: "The run ended before a comparable later decision occurred.",
      level: "neutral",
    };
  } else {
    verdict = {
      label: `${followed} of ${assessed.length} assessable changes altered behavior as expected`,
      detail: "This is behavioral follow-through, not proof that the poker decision was optimal.",
      level: followed / assessed.length >= 0.5 ? "positive" : "warning",
    };
  }

  return {
    seed: standings.seed,
    handsPlayed: standings.handsPlayed,
    verdict,
    coverage: {
      outcomesLinked: records.length === standings.handsPlayed,
      appliedChanges: applied.length,
      comparableChanges: assessed.length,
      counterfactualAvailable: false,
      sample: "exploratory",
    },
    players: standings.ranking.map((rank) => {
      const id = rank.playerId;
      const agent = standings.snapshot.agents[id];
      const evolution = standings.snapshot.evolution[id];
      const model = standings.snapshot.models[id];
      const ownEvents = evolutions.filter((event) => event.playerId === id);
      const ownProofs = proofs.filter((proof) => proof.playerId === id);
      const ownAssessed = ownProofs.filter((proof) => proof.followThrough !== "unassessed");
      const ownFollowed = ownAssessed.filter((proof) => proof.followThrough === "followed").length;
      const failureRate = model.calls ? (model.invalidCount + model.timeoutCount) / model.calls : 0;
      const stability = clamp(
        100 - Math.min(50, evolution.totalAbsMovement * 20) - evolution.oscillations * 15 - failureRate * 35,
      );
      return {
        playerId: id,
        name: rank.name,
        model: rank.model,
        outcomeLift: agent.adaptationGain,
        evidenceGrounding: evidenceGrounding(ownEvents),
        behaviorFollowThrough: ownAssessed.length ? round((ownFollowed / ownAssessed.length) * 100) : null,
        assessedChanges: ownAssessed.length,
        stabilityScore: round(stability),
        reliability: round((1 - failureRate) * 100),
        changes: evolution.changesApplied,
        modelMigrations: ownEvents.filter((event) => event.modelChanged).length,
        costUsd: model.estCostUsd,
      };
    }),
    proofs,
    pioneer: {
      inferenceIdsCaptured: new Set(
        actions.map((event) => event.agent?.inferenceId).filter((id): id is string => !!id),
      ).size,
      decisionsLinkedToOutcomes: records.reduce((sum, record) => sum + record.actions.length, 0),
      feedbackSubmitted: false,
      checkpointPromoted: false,
    },
    band: {
      playerEvents: trace.filter((message) => message.from !== "dealer").length,
      dealerEvents: trace.filter((message) => message.from === "dealer").length,
    },
  };
}
