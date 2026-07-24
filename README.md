# Evolving Poker

Four LLMs play poker and rewrite their own strategy after every hand.

Four persistent AI players, one mechanical dealer, six hands. Pioneer models choose
every fold, check, call, and raise from a legal-action list. Between hands each player
may rewrite its three strategy dials and migrate to another allowed Pioneer model.

All action and reflection calls are counted and shown on screen.

---

## Run it

Requires Node 20+ and `PIONEER_API_KEY` in `.env` for a live tournament.

```bash
npm install

npm run demo      # full live tournament + spectator UI at http://localhost:8787
npm run web       # legacy React UI dev server, only needed for component work
npm test          # 57 tests
```

Other entry points:

```bash
npm run tournament -- --seed 135                  # any seed
npm run serve -- --fixture fixtures/demo.json     # replay a recording
npm run serve -- --fixture fixtures/demo.json --speed 2 --loop
npm run record                                    # re-record fixtures/demo.json
npm run find-seed -- --limit 500                  # score seeds for demo-worthiness
npm run tune -- --seeds 1..20                     # per-model self-modification profile
npm run build                                     # production web bundle
```

The default seed is `135`; it fixes the deck, not the model decisions. Live Pioneer
runs are intentionally not deterministic.

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

- **Network dies / API down.** Replay the last credential-backed fixture. Live
  tournament mode never silently substitutes scripted agents.
- **Everything dies.** `npm run serve -- --fixture fixtures/demo.json` replays a
  committed recording with original pacing. The UI cannot tell the difference — it
  gets the same events on the same socket, and the header just says `REPLAY`.
- **Server dies mid-demo.** Restart fixture replay; the production browser bundle
  contains no scripted agent conversation or decisions.
- **Port 8787 taken.** The server says so and exits instead of stack-trace-ing.

---

## Architecture

```
shared/types.ts          single source of truth for every shape crossing a boundary
server/src/engine/       dealer: deck, evaluate, strength, legal betting, metrics
server/src/evolution/    Pioneer action agent, reflection, model migration, schemas
server/src/comm/         Band router + trace log
server/src/outputs/      cited.md report, x402 paywall + audit pack
server/src/index.ts      CLI + Hono server
spectator/index.html     integrated live poker broadcast served at /
web/src/                 React spectator UI (useReducer over the same event union)
```

Two rules the whole design hangs on:

1. **Agents decide; the engine enforces.** Pioneer receives private cards, public
   state, hand strength, personality, strategy, and legal actions. The engine owns
   legality, chip accounting, showdown evaluation, and safe failure fallback.
2. **Models are never strategically babysat.** `server/src/evolution/schema.ts` validates shape and
   range only — no step-size cap, no one-dial-at-a-time rule, no anti-reversal rule.
   If a model oscillates a dial, that is a finding, and `metrics.ts` counts it.

The parser repairs **transport, never judgement**: a dial sent as `"0.45"` becomes
`0.45` and evidence sent as a bare string gets wrapped, but an out-of-range dial is
still rejected. Every repair is recorded per model, because which model needed which
repair is itself a result. Each reflection gets at most one retry, and a rejected
response is fed back into that model's next prompt — a model that cannot see it was
rejected will emit the same broken shape again next hand.

### Tuning the prompt

`npm run tune -- --seeds 1..20` runs the same seeds and reports, per model: no-change
rate, dial drift per hand, oscillations, parse failures, repairs, calls spent, and
final chips. `--prompt-variant <file>` swaps the closing instruction block from a file
so wording can be A/B'd without editing source. Note that the mock adapter is scripted
and ignores prompt wording — a variant only moves these numbers under
`PIONEER_MODE=real`.

Failure is rendered, not swallowed. Invalid or timed-out action output becomes a
mechanical check/fold; invalid reflection output leaves strategy and model unchanged.

---

## Sponsor integrations

Copy `.env.example` to `.env`. The server loads it automatically; production service
URLs remain fixed in code.

### Pioneer (four different models, one per player)

- Add `PIONEER_API_KEY`. Live mode fails clearly if inference is unavailable; it never
  substitutes scripted agents. Mock adapters exist only for automated tests.
- The adapter uses Pioneer's fixed OpenAI-compatible endpoint,
  `https://api.pioneer.ai/v1/chat/completions`, with `X-API-Key` authentication.
- The default model IDs were verified against Pioneer's live decoder catalog.
  `MODEL_A` through `MODEL_D` remain optional shell overrides.
- `MODEL_POOL` optionally sets the comma-separated models agents may migrate to.
- Requests use Pioneer's default persistence so it can use the traffic for inference history,
  evaluation, clustering, and Adaptive Inference. A six-hand run does not claim a
  retraining cycle completed.

### Band (agent-to-agent messaging)

- Set `BAND_ROOM_ID` plus each player's `ID`, `HANDLE`, and `API_KEY`.
- Player actions, hand summaries, and evolution events are published through Band's
  REST API with real sender identities and recipient mentions.
- Dealer-only control messages remain local because the dealer has no Band identity.
  The complete local trace is always preserved for the UI and audit pack.

### Replay QA

- Replay is external QA, not a report publisher or runtime SDK.
- Deploy or run the React spectator app at a reachable URL, then submit that URL at
  `https://qa.replay.io/`.
- No application key, package, or environment variable is needed for the stand-alone
  or GitHub workflows.

### Local audit outputs

- `cited.md` is generated into the repo root and served at `/api/cited`.
- `GET /audit` is a test-only 402 demo endpoint; it is not a sponsor integration.

---

## Pre-demo checklist

- [ ] `npm install && npm test` — 57 green
- [ ] `npm run demo` finishes with chips conserved at 4000
- [ ] `npm run web` shows the tournament streaming live
- [ ] `curl localhost:8787/audit` returns 402
- [ ] `npm run serve -- --fixture fixtures/demo.json` replays cleanly
- [ ] Pioneer key in `.env`; one real reflection request succeeds
- [ ] Four Band remote agents and one shared room created
- [ ] Band REST transport publishes messages; local trace still populated
- [ ] Deployed spectator URL passes Replay QA
