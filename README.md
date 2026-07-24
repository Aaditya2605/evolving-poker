# Evolving Poker

Three LLMs play poker and rewrite their own strategy after every hand.

Three AI players, one deterministic dealer, six hands. No LLM ever picks a poker
action — the action loop is a pure function of `(hand strength, pot odds, strategy
dials)`. Between hands each player gets one shot at rewriting its own three strategy
dials, and the tournament shows you what that rewrite did to its results.

**6 hands x 3 players = exactly 18 LLM calls.** That is the whole model budget.

---

## Run it

Requires Node 20+. **No API keys. No network.**

```bash
npm install

npm run demo      # full 6-hand tournament, mock LLMs, server stays up on :8787
npm run web       # spectator UI at http://localhost:5173 (separate terminal)
npm test          # 33 tests
```

Other entry points:

```bash
npm run tournament -- --seed 135                  # any seed
npm run serve -- --fixture fixtures/demo.json     # replay a recording
npm run serve -- --fixture fixtures/demo.json --speed 2 --loop
npm run record                                    # re-record fixtures/demo.json
npm run find-seed -- --limit 500                  # score seeds for demo-worthiness
npm run build                                     # production web bundle
```

The default seed is `135`. It was not chosen by taste — `npm run find-seed` scanned
seeds 1..500 and scored them on bluffs, showdowns, distinct hand-winners and final
chip spread. Seed 135 gives 3 bluffs (one on hand 1), 4 showdowns, 3 different
winners, and a 1030 / 1000 / 970 finish.

### Endpoints

| Route | What |
| --- | --- |
| `ws://localhost:8787/ws` | live event stream (backlog replayed on connect; accepts `pause` / `play` / `speed`) |
| `GET /api/state` | current tournament snapshot |
| `GET /api/trace` | full agent-to-agent message log |
| `GET /api/cited` | generated `cited.md` |
| `GET /audit` | **402** with payment terms, then **200** with the audit pack once paid |
| `GET /fixtures/:name` | recorded runs |

---

## Demo disaster kit

- **Network dies / API down.** Nothing here needs the network. `PIONEER_MODE=mock`
  is the default and the mock adapter is scripted, not random.
- **Everything dies.** `npm run serve -- --fixture fixtures/demo.json` replays a
  committed recording with original pacing. The UI cannot tell the difference — it
  gets the same events on the same socket, and the header just says `REPLAY`.
- **Server dies mid-demo.** The web UI reconnects with backoff and falls back to
  playing `fixtures/demo.json` client-side.
- **Port 8787 taken.** The server says so and exits instead of stack-trace-ing.

---

## Architecture

```
shared/types.ts          single source of truth for every shape crossing a boundary
server/src/engine/       dealer: deck, evaluate, strength, decide, hand, metrics
server/src/evolution/    reflection: pioneer adapter, prompts, reflect loop, schema
server/src/comm/         Band router + trace log
server/src/outputs/      cited.md report, x402 paywall + audit pack
server/src/index.ts      CLI + Hono server
web/src/                 React spectator UI (useReducer over the same event union)
```

Two rules the whole design hangs on:

1. **The poker loop is pure.** `decide()` in `server/src/engine/decide.ts` takes a
   `DecisionContext` and returns a `Decision`. It deliberately ignores opponent
   statistics, so any change in a player's behavior traces back to a dial change and
   nothing else.
2. **Models are never babysat.** `server/src/evolution/schema.ts` validates shape and
   range only — no step-size cap, no one-dial-at-a-time rule, no anti-reversal rule.
   If a model oscillates a dial, that is a finding, and `metrics.ts` counts it.

Failure is rendered, not swallowed. The mock script deliberately returns malformed
JSON on hand 3 (both attempts) and times out on hand 5, so you can watch the retry,
the give-up, and the "strategy unchanged" card in the UI.

---

## Sponsor integrations

Everything below runs in mock/local/test mode by default and is a thin swap-in behind
an interface. Copy `.env.example` to `.env` to change modes — every variable is
optional.

### Pioneer (three different models, one per player)

- **Now:** `PIONEER_MODE=mock` — scripted personas, zero network.
- **At the event:** set `PIONEER_MODE=real`, `PIONEER_API_KEY`, `PIONEER_BASE_URL`, and
  `MODEL_A` / `MODEL_B` / `MODEL_C` in `.env`.
- **File to touch:** `server/src/evolution/pioneer.ts` — `PioneerAdapter` already speaks
  the OpenAI-compatible shape. Confirm the base URL and the header name; that is the
  whole change. `createAdapter()` at the bottom of the file picks mock vs real.
- Cost per call is estimated in `estimateCost()` in the same file. Set
  `PIONEER_PRICING` in `.env` (`model:inPer1k:outPer1k,...`) to make the on-screen
  number true.

### Band (agent-to-agent messaging)

- **Now:** `BAND_MODE=local` — `server/src/comm/trace.ts` writes a Band-shaped message
  log in-process.
- **At the event:** set `BAND_MODE=real`, `BAND_API_KEY`, `BAND_ROOM`. The trace is
  written identically in both modes, so every consumer (UI drawer, audit pack,
  `/api/trace`) is unaffected by the swap.
- **File to touch:** `server/src/comm/band.ts` — `BandRouter_Real.connect()` currently
  dynamic-imports a placeholder `band-sdk`. Replace that import and the `publish()`
  call with the real SDK surface; nothing outside the class changes. If the SDK fails
  to load it warns and degrades to local routing rather than dying.

### x402 (paywalled audit pack)

- **Now:** `X402_MODE=test` — `GET /audit` returns 402 with payment terms, then 200 with
  the pack once a payment header is present.
- **At the event:** set `X402_MODE=real`, `X402_PRICE_USD`, `X402_PAY_TO`.
- **File to touch:** `server/src/outputs/x402.ts` — swap the stub header check for real
  settlement verification. The route in `server/src/index.ts` does not change.

### Replay / cited.md

- **Now:** `cited.md` is generated into the repo root at the end of every tournament and
  served at `/api/cited`. It is gitignored — it is an artifact, not source.
- **At the event:** publish it to the Replay account. Nothing in the app depends on
  publication succeeding.
- **File to touch:** `server/src/outputs/report.ts` — `publishCited()` is a stub that
  warns and returns. Wire the event's publishing mechanism there. `generateCited()` in
  the same file owns the content.

---

## Pre-demo checklist

- [ ] `npm install && npm test` — 33 green
- [ ] `npm run demo` finishes with chips conserved at 3000
- [ ] `npm run web` shows the tournament streaming live
- [ ] `curl localhost:8787/audit` returns 402
- [ ] `npm run serve -- --fixture fixtures/demo.json` replays cleanly
- [ ] Pioneer keys + three model IDs in `.env` (see above)
- [ ] Band SDK swapped in `trace.ts`, trace still populated
- [ ] `cited.md` published to Replay
