# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

Node 20+. npm workspaces (`server`, `web`); run everything from the repo root.

```bash
npm install
npm run demo                                      # 6-hand tournament at seed 135, server stays up on :8787
npm run web                                       # Vite spectator UI on :5173 (separate terminal)
npm test                                          # vitest, server workspace
npm run tournament -- --seed 135 --hands 6        # arbitrary seed / hand count; --no-serve for headless
npm run serve -- --fixture fixtures/demo.json     # replay a recording (--speed N, --loop)
npm run record                                    # re-record fixtures/demo.json
npm run find-seed -- --limit 500                  # score seeds 1..N for demo-worthiness
npm run tune -- --seeds 1..20                     # per-model self-modification profile
npm run build                                     # production web bundle into web/dist
```

Single test file / single test:

```bash
npm run test --workspace server -- test/evolution.test.ts
npm run test --workspace server -- -t "oscillation"
npm run test:watch --workspace server
```

Typecheck is per-workspace, no root script: `npm run typecheck --workspace server`, `npm run typecheck --workspace web`. There is no linter and no formatter config.

Nothing requires network or keys. `PIONEER_MODE=mock`, `BAND_MODE=local`, `X402_MODE=test` are the defaults; `.env.example` documents the real-mode variables, all optional.

## Architecture

```
shared/types.ts        every type that crosses a boundary; imported by server/ and web/ alike
server/src/engine/     dealer: deck, evaluate, strength, decide, hand, metrics, tournament
server/src/evolution/  reflection: pioneer adapter, prompt, reflect loop, zod schema
server/src/comm/       Band router + trace log
server/src/outputs/    cited.md report, x402 paywall + audit pack
server/src/index.ts    CLI (tournament | serve | find-seed) + Hono server + static/fixture serving
server/src/ws.ts       Broadcaster: WS fan-out, backlog replay, pause/speed gate
web/src/               React spectator UI, useReducer over the same event union
```

### The two invariants the design hangs on

1. **The poker loop is pure.** `decide()` (`server/src/engine/decide.ts`) maps `(DecisionContext, Strategy) → Decision` and nothing else. It deliberately does not see opponent statistics — if stats fed decisions, behavior would drift without a strategy change and the auditability claim ("a changed action traces back to a changed dial") would be false. Opponent stats reach the *models* during reflection only. Do not widen `DecisionContext` with opponent data.
2. **Models are never babysat.** `server/src/evolution/schema.ts` validates shape and range only — no step-size cap, no one-dial-at-a-time rule, no anti-reversal rule. A model may swing a dial 0.1 → 0.9 → 0.1. Oscillation is *measured* (`countOscillations` in `metrics.ts`, `OSCILLATION_DELTA`/`OSCILLATION_WINDOW` in `shared/types.ts`), never prevented.

The parser repairs **transport, never judgement**: a dial arriving as `"0.45"` is coerced to `0.45`, a bare evidence string is wrapped, an over-long reason is truncated — but an out-of-range dial is still rejected. Every repair is recorded on `EvolutionEvent.repairs` and rolled up per model, because which model needed which repair is itself a result. Keep new repairs on the transport side of that line.

### Determinism

A seed fully determines a frozen-strategy run. Every random draw routes through `seededRand(key)` in `server/src/engine/deck.ts` (FNV-1a hash → mulberry32), keyed by strings like `${seed}:${handId}:${playerId}:${actionIndex}`. `handStrength()` is exact by default (enumerates all C(47,2)=1081 opponent holdings) and only Monte-Carlos when `samples` is passed, which `find-seed` does for speed. Tests assert byte-identical event logs across two runs with `reflections: false`. Changing the constants in `decide.ts` or the RNG key format invalidates the committed fixture and the chosen seed.

### The event stream is the only contract

`TournamentEvent` in `shared/types.ts` is the single union produced by `runTournament` and consumed by: the CLI logger, the WS broadcaster, the fixture recorder, the audit pack, and the web reducer. Live runs, fixture replay (`npm run serve`), and the UI's client-side offline fallback all deliver the *same* events on the *same* socket — nothing in the payload distinguishes them. The LIVE/REPLAY badge comes from an out-of-band `{type:"mode"}` hello frame in `ws.ts`. Adding an event variant means touching `web/src/state/reducer.ts` too.

`shared/types.ts` is dependency-free and imported by relative path from both workspaces (`../../shared/types.js` from server, `../../../shared/types` from web). Keep it that way.

### Tournament flow

`runTournament` (`engine/tournament.ts`) loops hands: `playHand()` → `MetricsTracker.recordHand()` → `reflectAll()` → metrics snapshot. `reflectAll` runs all three players' reflections concurrently via `Promise.allSettled` and **never throws and never stalls** — every player gets an `EvolutionEvent` every hand, with `status` of `applied | no_change | invalid | timeout`, and `after === before` on any failure. `reflectOne` retries once with a hint appended (`withRetryHint`) before giving up. Failure is rendered, not swallowed.

Two counts, deliberately separate: **reflections** are `hands × players` (18 on the demo), exactly one per player per hand; **`llmCalls`** are adapter calls actually spent, which is higher whenever a retry fires (19 on the demo seed). `EvolutionEvent.llmCalls` is 1 or 2; `MetricsSnapshot.totals` carries both numbers. Don't collapse them back into one.

`ReflectionInput.evolutionHistory` includes **failed** reflections — rejected, timed out and explicit no-change entries, each tagged with `status` and capped at the last six. A model that cannot see its hand-3 response was rejected emits the same broken shape on hand 4, so don't filter this back down to applied-only.

`coerceLegal()` in `engine/hand.ts` is the last line of defense on illegal actions (raise when `!canRaise`, check facing a bet, call with nothing to call); each coercion is recorded on the tracker and surfaces in `cited.md`.

### Mock adapter is scripted, not random

`MockAdapter` in `evolution/pioneer.ts` encodes three deliberate personas — playerA eager updater, playerB conservative, playerC oscillator — and two deliberate failures: playerC returns malformed JSON on hand 3 (**both** attempts, so the retry path is exercised) and playerB times out on hand 5. Tests and the demo narrative depend on these; changing the script changes what the UI shows. `new MockAdapter(0)` disables latency for tests; `createAdapter(1)` gives real-time pacing.

### Swap points for the real integrations

Each is a thin implementation behind an interface; the rest of the app is unaffected by the swap.

- **Pioneer LLM** — `evolution/pioneer.ts`. `PioneerAdapter` already speaks OpenAI-compatible chat-completions; `createAdapter()` at the bottom picks mock vs real from `PIONEER_MODE`. Pricing for `estCostUsd` lives in `estimateCost()` / `PIONEER_PRICING`. One model per player via `MODEL_A`/`MODEL_B`/`MODEL_C`.
- **Band messaging** — `comm/band.ts`. `BandRouter_Real.connect()` dynamic-imports a placeholder `band-sdk` and degrades to local routing with a warning if it fails to load. The trace (`comm/trace.ts`) is written identically in both modes, so `/api/trace`, the UI drawer and the audit pack don't care.
- **x402 paywall** — `outputs/x402.ts`. Test mode accepts the header `X-PAYMENT: test-ok`; the route mounted in `index.ts` does not change when swapping in real settlement.
- **Replay publishing** — `outputs/report.ts`. `generateCited()` owns the content; `publishCited()` is a stub that warns and returns.

### Constants

Game constants (`STARTING_CHIPS`, `ANTE`, `RAISE_AMOUNT`, `TOTAL_HANDS`, `NEUTRAL_STRATEGY`, oscillation thresholds) live in `shared/types.ts` so the UI and engine agree. Decision-tuning constants (`RAISE_BAR_BASE`, `BLUFF_HS_CAP`, call blend weights) live in `decide.ts` and must not change mid-tournament. `REFLECT_TIMEOUT_MS` and the three personas' names/colors/initial dials are in `server/src/config.ts`.

`cited.md` and `audit-pack.json` are generated artifacts and gitignored — never commit or hand-edit them.

## Endpoints

| Route | What |
| --- | --- |
| `ws://localhost:8787/ws` | event stream; backlog replayed on connect; accepts `{type:"control",action:"pause"\|"play"\|"speed"}` |
| `GET /api/state` | mode, seed, running, integration modes, controls |
| `GET /api/trace` | full agent-to-agent message log |
| `GET /api/cited` | generated `cited.md` |
| `GET /audit` | 402 with payment terms, then 200 with the audit pack once paid |
| `GET /fixtures/:name` | recorded runs (also served by the Vite dev server from the repo-root `fixtures/`) |

The Vite dev server proxies `/api` and `/ws` to `:8787`, so run the tournament and `npm run web` side by side. `web/dist`, when built, is served by the Hono server at `/`.

## Tests

50 tests across `server/test/engine.test.ts` (14) and `server/test/evolution.test.ts` (36), numbered to match the spec's guarantees: chip conservation at every action boundary, determinism, `decide()` monotonicity in each dial, reflection schema parsing and repair, betting legality, oscillation counting, plus mock-persona, reflection-input and prompt-builder coverage. Chips must always sum to 3000 — that assertion is the fastest signal that an engine change broke something.
