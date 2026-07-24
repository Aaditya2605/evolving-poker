# Evolving Poker — Spectator UI

Single-file spectator interface for the Evolving Poker demo. No build step, no
dependencies, no install. Open `index.html` in any browser and it runs.

---

## What this is

The spectator front end described in §16–17 of `SPEC.md`: a poker table, a Band
message bus rendered as conversation, a live evolution log, and a play-by-play
ticker. It ships with a scripted fixture demo so it can be shown, tested and
rehearsed without spending a single Pioneer credit.

It is **one HTML file**. All CSS and JS are inline. That is deliberate — it means
QA, rehearsal and the fallback demo recording never depend on a dev server.

---

## Running it

**Fixture mode (default)**

```
open index.html
```

Runs the scripted six-hand demo on a loop. This is what Replay should test
against — deterministic, free, and identical on every run.

**Live mode**

The server automatically connects the page to its `/ws` endpoint:

```
npm run demo
# open http://localhost:8787
```

The scripted timeline is skipped and the UI is driven by real server events.
Use `?fixture=1` only when opening the standalone scripted design fixture.

---

## Layout

| Region | What it shows |
|---|---|
| Header | Hand progress, pot, Pioneer call count, running cost, play/pause/speed |
| The Table | 4 seats, hole cards face up, community cards, denominated chip stacks, per-seat bet chips, live strategy dials, decision bubbles |
| Table Talk | Band message bus — dealer routing plus agent chatter |
| Evolution Log | One card per reflection: dial diffs, reason, evidence, latency, cost |
| Ticker | Play-by-play commentary strip |

Drag the gutters between panels to resize. Use the `‹` / `›` buttons in the
Table Talk and Evolution Log headers to collapse either panel to a rail and hand
the space to the table.

`Design notes` (bottom right) overlays the annotated design rationale and the
token legend.

---

## Wiring it to the real engine

The live adapter calls the **same render functions** as the fixture script —
`act()`, `evoCard()`, `setDial()`, `say()`, `tickNote()`. There is no duplicate
rendering path, so anything that looks right in fixture mode looks right live.

### Expected frame

```jsonc
{ "type": "trace",
  "message": { "ts": 0, "seq": 0, "from": "playerA", "to": "dealer",
               "kind": "turn_action", "payload": { } } }
```

Handled kinds: `turn_request`, `turn_action`, `hand_summary`, `evolution_event`.

### Three things to check before it works

The live adapter is wired to `playerA` through `playerD`, the server's
`hand_start` shape, and Band trace events. Table Talk shows the agents' real
public decision reasons; it does not invent banter.

---

## Files

```
index.html            the whole app
SPEC.md               product spec this was built against
reference/
  BandWire.tsx        React equivalent of the Table Talk panel
  agent-wire.patch    server + reducer changes that emit trace events
```

`reference/` is context for whoever integrates this, not part of the build.

---

## Notes for integrators

- Fixture mode must keep working. It is the Replay QA target and the demo
  fallback if the network dies on stage.
- Seats occupy four corner columns; the board and pot own the empty centre
  column. The two top seats are positioned with `min(27%, calc(50% - 168px))` /
  `max(73%, calc(50% + 168px))` so they can never drift inward over the
  community cards, at any table width. Keep those clamps if you move seats.
- Everything that used to float over the felt — bet chips, the decision line,
  the dealer button — now lives inside the seat column with reserved height.
  That is what keeps the layout collision-free and scroll-free.
- Chip totals are conserved across every hand in the fixture ($4,000).
- Pacing is a single `PACE` constant in the scheduler. Raise it to slow the
  whole demo down without touching individual beats.
- Reduced motion is respected via `prefers-reduced-motion`.
