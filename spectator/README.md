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

Append the WebSocket URL as a query parameter:

```
index.html?live=ws://localhost:8787/stream
```

The scripted timeline is skipped entirely and the UI is driven by real server
events. The Play button becomes a `● LIVE` badge. Connection status appears in
the Table Talk panel.

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

1. **Seat id mapping.** The `WID` map translates server ids (`playerA`,
   `playerB`, …) to internal seat ids (`A`, `B`, `N`, `C`). If the fourth seat
   is not named `playerN`, edit that one line.

2. **Deal events.** Board and hole cards arrive as separate `TournamentEvent`
   types, not as `trace` messages. `onEvent()` has placeholder handlers for
   `hand_start` and `board`. Open the browser console on first connect — every
   unrecognised event logs its real shape, then fill in the two handlers.

3. **The `banter` field.** Agent chatter is currently written fiction. To make
   it real, add one field to the reflection response schema:

   ```
   "banter": "one sentence, in character, addressed to the table. No numbers."
   ```

   This costs **zero extra LLM calls** — it rides along on the reflection call
   that already happens once per agent per hand. The "no numbers" instruction
   matters: dial values belong in the Evolution Log, not in chat.

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
