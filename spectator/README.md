# Evolving Poker — Spectator UI

Single-file spectator interface for the Evolving Poker demo. No front-end build
step or dependencies.

---

## What this is

The spectator front end described in §16–17 of `SPEC.md`: a poker table, a live
agent-activity wire, an evolution log, and a play-by-play ticker.

It is **one HTML file**. All CSS and JS are inline.

---

## Running it

```bash
npm run demo
# open http://localhost:8787
```

The idle control screen lets the operator select one starting Pioneer model per
seat and choose 1–30 hands. The server validates both before spending credits.

For credit-free QA, replay a server-side recording through the same event stream:

```bash
npm run serve -- --fixture fixtures/demo.json
```

---

## Layout

| Region | What it shows |
|---|---|
| Header | Hand progress, pot, Pioneer call count, running cost |
| The Table | 4 seats, hole cards face up, community cards, denominated chip stacks, per-seat bet chips, live strategy dials, decision bubbles |
| Agent Wire | Real Pioneer decision reasons and reflections; player events delivered through Band |
| Adaptation | Four vertically stacked chip trajectories, strategy-change markers, and directional second-half gain |
| Ticker | Play-by-play commentary strip |

Drag the gutters between panels to resize. Use the `‹` / `›` buttons in the
Agent Wire and Adaptation headers collapse either side panel to a rail and hand
the space to the table.

The adaptation monitor deliberately does not claim “accuracy”: poker has no
labeled correct action. It reports observed chip outcomes, strategy changes,
oscillation, and the existing second-half-versus-first-half directional gain.
Detailed reflection evidence remains available in `cited.md` and `/audit`.

---

## Live event stream

The browser consumes the server's WebSocket frames:

```jsonc
{ "type": "trace",
  "message": { "ts": 0, "seq": 0, "from": "playerA", "to": "dealer",
               "kind": "turn_action", "payload": { } } }
```

Handled kinds: `turn_request`, `turn_action`, `hand_summary`, `evolution_event`.

The adapter is wired to `playerA` through `playerD`, the server's `hand_start`
shape, and trace events. Agent Wire shows real public decision reasons returned
by Pioneer; the surrounding event labels are application UI, not free-form chat.

---

## Files

```
index.html            the whole app
SPEC.md               product spec this was built against
reference/
  BandWire.tsx        React equivalent of the Agent Wire panel
  agent-wire.patch    server + reducer changes that emit trace events
```

`reference/` is context for whoever integrates this, not part of the build.

---

## Notes for integrators

- Server-side fixture replay is the Replay QA target and network fallback.
- Seats occupy four corner columns; the board and pot own the empty centre
  column. The two top seats are positioned with `min(27%, calc(50% - 168px))` /
  `max(73%, calc(50% + 168px))` so they can never drift inward over the
  community cards, at any table width. Keep those clamps if you move seats.
- Everything that used to float over the felt — bet chips, the decision line,
  the dealer button — now lives inside the seat column with reserved height.
  That is what keeps the layout collision-free and scroll-free.
- Chip totals are conserved across every hand ($4,000).
- Reduced motion is respected via `prefers-reduced-motion`.
