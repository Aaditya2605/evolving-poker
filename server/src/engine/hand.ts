import type { Hand as SolvedHand } from "pokersolver";
import type {
  Action,
  Decision,
  DecisionContext,
  HandAction,
  HandRecord,
  PlayerId,
  PlayerState,
  TournamentEvent,
} from "../../../shared/types.js";
import { ANTE, PLAYER_IDS, RAISE_AMOUNT, STARTING_CHIPS } from "../../../shared/types.js";
import { shuffledDeck } from "./deck.js";
import { decide } from "./decide.js";
import { evaluate, winnerIndices } from "./evaluate.js";
import { handStrength, type StrengthOptions } from "./strength.js";

export interface HandDeps {
  emit?: (event: TournamentEvent) => void;
  traceTurnRequest?: (playerId: PlayerId, ctx: DecisionContext) => void;
  traceTurnAction?: (playerId: PlayerId, decision: Decision, potAfter: number) => void;
  onCoercion?: (note: string) => void;
}

export interface PlayHandArgs {
  handId: number;
  seed: string;
  players: PlayerState[]; // chips are read, not mutated
  strengthOptions?: StrengthOptions;
  deps?: HandDeps;
}

export interface HandResult {
  record: HandRecord;
  chipsAfter: Record<PlayerId, number>;
  dealer: PlayerId;
}

function emptyRecord<T>(fill: (id: PlayerId) => T): Record<PlayerId, T> {
  return {
    playerA: fill("playerA"),
    playerB: fill("playerB"),
    playerC: fill("playerC"),
  };
}

/** Dealer button advances one seat every hand. Hand 1 → playerA. */
export function dealerFor(handId: number): PlayerId {
  return PLAYER_IDS[(handId - 1) % PLAYER_IDS.length];
}

export function playHand(args: PlayHandArgs): HandResult {
  const { handId, seed, players, strengthOptions, deps = {} } = args;
  const byId = emptyRecord((id) => players.find((p) => p.id === id)!);

  const dealerIdx = (handId - 1) % PLAYER_IDS.length;
  const dealer = PLAYER_IDS[dealerIdx];
  // Action starts left of the button and rotates with it.
  const order: PlayerId[] = [];
  for (let i = 1; i <= PLAYER_IDS.length; i++) {
    order.push(PLAYER_IDS[(dealerIdx + i) % PLAYER_IDS.length]);
  }

  // --- deal -----------------------------------------------------------------
  const deck = shuffledDeck(seed, handId);
  let cursor = 0;
  const holeCards = emptyRecord<string[]>(() => []);
  for (let round = 0; round < 2; round++) {
    for (const id of order) holeCards[id].push(deck[cursor++]);
  }
  const communityCards = [deck[cursor++], deck[cursor++], deck[cursor++]];

  // --- antes ----------------------------------------------------------------
  const chipsBefore = emptyRecord((id) => byId[id].chips);
  const chips = emptyRecord((id) => byId[id].chips);
  let pot = 0;
  for (const id of PLAYER_IDS) {
    if (chips[id] < ANTE) throw new Error(`${id} cannot post the ante — chip floor reached`);
    chips[id] -= ANTE;
    pot += ANTE;
  }

  const strength = emptyRecord((id) =>
    handStrength(holeCards[id], communityCards, {
      ...strengthOptions,
      rngKey: strengthOptions?.samples !== undefined ? `${seed}:${handId}:${id}:hs` : undefined,
    }),
  );

  deps.emit?.({
    type: "hand_start",
    handId,
    communityCards,
    holeCards,
    dealer,
    chips: { ...chips },
    pot,
  });

  // --- single betting round -------------------------------------------------
  const active = emptyRecord(() => true);
  const committed = emptyRecord(() => 0);
  const hasRaised = emptyRecord(() => false);
  const hasActed = emptyRecord(() => false);
  const actions: HandAction[] = [];

  let currentBet = 0;
  let actionIndex = 0;
  let pointer = 0;
  let guard = 0;

  while (true) {
    if (++guard > 100) throw new Error(`betting round failed to terminate on hand ${handId}`);
    if (PLAYER_IDS.filter((id) => active[id]).length <= 1) break;

    let found = -1;
    for (let k = 0; k < order.length; k++) {
      const slot = (pointer + k) % order.length;
      const cand = order[slot];
      if (!active[cand]) continue;
      if (!hasActed[cand] || committed[cand] < currentBet) {
        found = slot;
        break;
      }
    }
    if (found === -1) break;
    pointer = (found + 1) % order.length;

    const id = order[found];
    const toCall = currentBet - committed[id];
    const ctx: DecisionContext = {
      handId,
      playerId: id,
      handStrength: strength[id],
      potSize: pot,
      toCall,
      raiseAmount: RAISE_AMOUNT,
      canRaise: !hasRaised[id] && chips[id] > toCall,
      myChips: chips[id],
      actionIndex,
      seed,
    };
    deps.traceTurnRequest?.(id, ctx);

    let decision = decide(ctx, byId[id].strategy);
    decision = coerceLegal(decision, ctx, deps.onCoercion);

    hasActed[id] = true;
    actionIndex++;

    const act: Action = decision.action;
    if (act === "fold") {
      active[id] = false;
    } else if (act === "call" || act === "raise") {
      const amount = Math.min(decision.amount, chips[id]);
      chips[id] -= amount;
      committed[id] += amount;
      pot += amount;
      if (act === "raise") {
        hasRaised[id] = true;
        currentBet = Math.max(currentBet, committed[id]);
      }
      decision = { ...decision, amount };
    }

    const entry: HandAction = {
      playerId: id,
      action: act,
      amount: act === "fold" || act === "check" ? 0 : decision.amount,
      potAfter: pot,
      isBluff: decision.isBluff,
    };
    actions.push(entry);
    deps.traceTurnAction?.(id, decision, pot);
    deps.emit?.({
      type: "action",
      handId,
      playerId: id,
      action: entry.action,
      amount: entry.amount,
      potAfter: pot,
      isBluff: entry.isBluff,
    });
  }

  // --- resolution -----------------------------------------------------------
  const remaining = order.filter((id) => active[id]);
  const handNames: Partial<Record<PlayerId, string>> = {};
  let showdown: PlayerId[] = [];
  let winners: PlayerId[];

  if (remaining.length === 1) {
    winners = [remaining[0]];
  } else {
    showdown = remaining.slice();
    const solved: SolvedHand[] = [];
    for (const id of showdown) {
      const ev = evaluate(holeCards[id], communityCards);
      handNames[id] = ev.descr || ev.name;
      solved.push(ev.hand);
    }
    winners = winnerIndices(solved).map((i) => showdown[i]);
  }

  const potSize = pot;
  const share = Math.floor(potSize / winners.length);
  let remainder = potSize - share * winners.length;
  for (const id of winners) {
    chips[id] += share;
  }
  if (remainder > 0) {
    // Remainder goes to the earliest seat in action order among the winners.
    const first = order.find((id) => winners.includes(id))!;
    chips[first] += remainder;
    remainder = 0;
  }

  const total = PLAYER_IDS.reduce((sum, id) => sum + chips[id], 0);
  if (total !== STARTING_CHIPS * PLAYER_IDS.length) {
    throw new Error(`chip conservation violated on hand ${handId}: ${total}`);
  }

  const record: HandRecord = {
    handId,
    communityCards,
    holeCards,
    handStrength: strength,
    actions,
    showdown,
    winner: winners[0],
    winners,
    potSize,
    chipDeltas: emptyRecord((id) => chips[id] - chipsBefore[id]),
    handNames,
  };

  return { record, chipsAfter: chips, dealer };
}

/** Mechanical legality only — never strategic. Coercions are logged, not hidden. */
export function coerceLegal(
  d: Decision,
  ctx: DecisionContext,
  onCoercion?: (note: string) => void,
): Decision {
  if (d.action === "raise" && !ctx.canRaise) {
    onCoercion?.(
      `hand ${ctx.handId}: ${ctx.playerId} attempted an illegal raise (already raised or insufficient chips) — coerced to ${ctx.toCall > 0 ? "call" : "check"}`,
    );
    return ctx.toCall > 0
      ? { action: "call", amount: Math.min(ctx.toCall, ctx.myChips), isBluff: false }
      : { action: "check", amount: 0, isBluff: false };
  }
  if (d.action === "check" && ctx.toCall > 0) {
    onCoercion?.(
      `hand ${ctx.handId}: ${ctx.playerId} attempted to check facing a bet — coerced to fold`,
    );
    return { action: "fold", amount: 0, isBluff: false };
  }
  if (d.action === "call" && ctx.toCall === 0) {
    onCoercion?.(`hand ${ctx.handId}: ${ctx.playerId} called with nothing to call — coerced to check`);
    return { action: "check", amount: 0, isBluff: false };
  }
  return d;
}
