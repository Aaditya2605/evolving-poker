# Evolving Poker

## Comprehensive Hackathon Product Specification

**Working title:** Evolving Poker
**Project type:** Agent playground, model-evaluation experiment, and live spectator demo
**Hackathon constraint:** Four-hour implementation window
**Primary sponsor track:** Pioneer
**Additional sponsor tools:** Band and Replay
**Required challenge outputs:** Continuous self-evolution loop, real actions, grounded evidence, publication to `cited.md`, and monetisation through an agent payment rail such as x402

---

## 1. Executive Summary

Evolving Poker is a live experiment where three AI agents play a simplified poker game and update their own strategies after every hand.

The agents do not ask an LLM to choose every fold, call, or raise. Those in-game actions are produced by a deterministic poker engine using three strategy values:

- Aggression
- Bluff rate
- Call threshold

After each hand, each agent’s assigned language model receives the result of the hand, cumulative statistics, its current strategy, and the history of its previous strategy changes. The model then decides whether the strategy should remain unchanged or whether any of the three values should be updated.

The models are not fine-tuned during the tournament. Their weights stay fixed. What evolves is each agent’s external strategy state and memory.

The frontend is a spectator experience styled like an online poker table. The audience sees the cards, bets, chips, and actions on one side, while a live evolution feed shows every strategy change on the other side. Every change is shown as a readable diff with the evidence the model used.

The project is not primarily a poker product. Poker is the controlled environment used to answer a broader question:

> How do different models learn from repeated, noisy feedback, and which model adapts most effectively without overreacting?

The hackathon version should use three different models through Pioneer, three persistent agent identities orchestrated through Band, and Replay to test the web application. A tournament report is published to `cited.md`, and a minimal x402-protected endpoint sells the full match audit pack.

---

## 2. The Core Idea in Simple Terms

Three AI models sit at a poker table.

They all begin with the same basic strategy.

The game engine deals cards and makes their poker decisions using their current strategy values.

After every hand, each model studies what happened and decides whether its strategy should change.

One model may become more aggressive. Another may stop bluffing so much. Another may decide there is not enough evidence to change anything.

The audience can watch every update happen in real time.

The system measures which model:

- Wins the most chips
- Improves the most over time
- Makes useful strategy changes
- Avoids chaotic overreaction
- Responds fastest
- Costs the least

The essential loop is:

**Play a hand → collect evidence → let each model update its strategy → apply the update → play again**

---

## 3. Why Poker Is the Environment

Poker is useful because it combines several properties that are difficult to get in a four-hour hackathon project.

### Repeated interaction

The same agents face each other repeatedly. This gives them a reason to remember previous behaviour and adapt.

### Objective outcomes

Every hand produces measurable results:

- Chips gained or lost
- Bluff succeeded or failed
- Bet was called or folded to
- Showdown was won or lost

The models are not judged only by whether their explanation sounds convincing.

### Noisy feedback

A model can make a sensible decision and still lose because of the cards. It can also make a poor decision and win through luck.

This is important because real agents also operate under uncertain feedback. The experiment tests whether a model understands that one result does not necessarily prove a strategy is good or bad.

### Easy-to-understand behaviour

An audience can understand statements such as:

- “This model bluffed too often.”
- “This model learned that its opponent rarely folds.”
- “This model changed from aggressive to cautious.”
- “This model kept reversing its strategy after every loss.”

### Strong visual demo

A poker table is much more engaging than a dashboard full of abstract task traces.

### Auditable evolution

Every strategy update is a small, readable change. Judges can see exactly what changed and why.

---

## 4. What the Project Is and Is Not

### It is

- A live agent playground
- A model adaptation benchmark
- A visual demonstration of external-memory evolution
- A comparison of model judgement under noisy feedback
- A Pioneer-focused model-routing experiment
- An auditable agent system
- A hackathon demo designed to be built in four hours

### It is not

- A production poker platform
- A real-money gambling product
- A complete casino-grade Texas Hold’em engine
- A startup that fixes production software
- A model-training or fine-tuning system
- Proof that a model has permanently learned
- A claim that no one has ever made AI models play poker
- A full scientific benchmark with statistically conclusive results

The distinct angle is not merely “AI plays poker.” The angle is:

> A live, cross-model arena where strategy memory changes after every hand, every change is inspectable, and adaptation quality, stability, latency, and cost are measured together.

---

## 5. Final Recommended Configuration

### Number of poker agents

Use **three poker agents**.

This is the best balance for the hackathon:

- Two players would be too narrow and feel like a heads-up demonstration.
- Three players provide meaningful bluffing, folding, and opponent interactions.
- Four players are visually stronger but add more state and one-third more model calls.
- Six players were arbitrary and unnecessarily expensive.
- Eight or ten players would be difficult to follow and would add no proportional value.

There is also one deterministic dealer or game-controller process. Therefore, Band may show four named entities in total:

- Dealer
- Player A
- Player B
- Player C

### Number of models

Use **three different models**, one per player.

Candidate model categories:

- A cheap lightweight model, such as a small Qwen model
- A medium open model, such as GPT-OSS or a similar option
- A stronger but still affordable model, such as DeepSeek or another model available through Pioneer

The exact models should be selected at kickoff based on:

- Pioneer’s available catalogue
- Hackathon credits
- Current latency
- Structured-output reliability
- Cost

Do not lock the project to a specific model name before confirming availability.

### Number of hands

Use **six hands** for the core demo.

This produces:

- Three models
- One reflection call per model after each hand
- Eighteen total LLM calls

Six hands are enough to show multiple strategy updates while keeping the tournament short and predictable.

A nine-hand mode can exist as an optional longer run, but six hands should be the default hackathon demo.

### Evolution frequency

Run an evolution step **after every hand**.

The model is allowed to decide that no change is needed. The system should not force an update.

This makes the evolution continuous and visible while preserving model autonomy.

---

## 6. The Central Architectural Decision

The language models do **not** choose every poker action.

Normal fold, check, call, and raise decisions are produced locally by the deterministic game engine.

The LLM is used only as the agent’s strategy coach after each hand.

This decision is critical because it:

- Reduces API calls dramatically
- Prevents sequential model latency during every betting turn
- Makes the game reproducible
- Keeps costs predictable
- Separates poker mechanics from model judgement
- Makes it easier to prove that strategy changes caused behaviour changes

The project therefore evaluates the models’ ability to learn and update a strategy, not their ability to produce valid poker actions from free-form prompts.

---

## 7. The Three Strategy Values

Every agent has the same three editable strategy parameters.

All values range from 0 to 1.

### Aggression

Aggression controls how readily the agent raises instead of checking or calling when it has a reasonable hand.

A low aggression value causes the agent to:

- Check more often
- Call more often
- Raise only with stronger hands

A high aggression value causes the agent to:

- Raise more frequently
- Apply more pressure
- Contest more pots

### Bluff rate

Bluff rate controls how often the agent represents strength while holding a weak hand.

A low bluff rate makes the agent more honest and predictable.

A high bluff rate makes the agent more deceptive but vulnerable to opponents who call frequently.

### Call threshold

Call threshold controls how strong the agent’s hand must be before it calls another player’s bet.

A low call threshold makes the agent a loose caller.

A high call threshold makes the agent fold unless it has stronger evidence.

### Starting values

For a clean model-comparison experiment, all three agents should start with the same neutral strategy.

A reasonable baseline could be:

| Strategy | Starting value |
|---|---:|
| Aggression | 0.50 |
| Bluff rate | 0.30 |
| Call threshold | 0.50 |

Using the same starting strategy prevents personality presets from confounding the model comparison.

The agents may still have different names, colours, avatars, and model labels for visual clarity.

---

## 8. How Poker Decisions Are Made

The deterministic engine combines:

- Hand strength
- Current strategy values
- Current amount required to call
- Pot size
- Public opponent statistics
- A seeded random value used for bluffing
- Legal actions

The engine then chooses one legal action:

- Fold
- Check
- Call
- Fixed-size raise

The exact decision formula does not need to be shown to the audience, but it must be consistent and deterministic.

The important property is:

> If the cards, table state, and strategy values are identical, the action should be identical.

This makes it possible to trace a changed action back to a changed strategy.

The model never determines whether an action is legal. The engine owns the rules.

---

## 9. Simplified Poker Rules

Do not build full Texas Hold’em.

Use a recognisable but reduced version.

### Recommended format

- Three players
- Fixed starting chip stacks
- Two private cards per player
- Three public community cards
- One betting round
- Showdown after the betting round
- Fixed blind or ante
- Fixed raise amount
- Maximum one raise per player per hand
- No all-ins
- No side pots
- No rebuys
- Seeded deck shuffling
- Existing hand-evaluation library to determine the winner

This is enough to support:

- Bluffing
- Folding
- Calling
- Raising
- Showdowns
- Learning opponent tendencies

The audience will recognise it as poker without the team implementing every edge case.

---

## 10. The Metrics the Engine Tracks

The game engine should calculate metrics automatically. The models should not be responsible for counting or interpreting raw logs.

### Per-agent performance metrics

- Starting chips
- Current chips
- Net chip change
- Chips gained or lost in the latest hand
- Hands entered
- Hands folded
- Calls made
- Raises made
- Showdowns reached
- Showdowns won
- Bluffs attempted
- Successful bluffs
- Failed or caught bluffs

### Per-opponent behavioural metrics

For each opponent, track:

- Times faced a raise
- Times folded to a raise
- Times called a raise
- Times raised
- Showdowns won
- Estimated fold-to-raise rate
- Estimated call rate
- Estimated aggression rate

### Strategy-evolution metrics

- Number of strategy updates
- Number of “no change” decisions
- Total absolute strategy movement
- Number of parameter reversals
- Number of consecutive updates to the same parameter
- Strategy volatility
- Average chips per hand before and after updates
- Whether later behaviour changed in the expected direction

### Model-performance metrics

- Total model calls
- Total input tokens
- Total output tokens
- Estimated inference cost
- Average response latency
- Invalid response count
- Timeout count
- Strategy-update frequency
- Strategy oscillation
- Final chip performance
- Adaptation gain

---

## 11. What “Adaptation Gain” Means

Raw chip totals are affected by luck.

A model may receive strong cards and win without learning anything. Another model may make sensible updates but receive weak cards.

The dashboard should therefore separate:

### Final chip result

The simplest tournament result: how many chips the agent finishes with.

### Adaptation gain

A comparison between performance before and after strategy updates.

A simple hackathon-level version:

- Calculate average chips per hand during the first half of the tournament
- Calculate average chips per hand during the second half
- Subtract the first-half result from the second-half result

This is not scientifically perfect, but it gives the audience a directional measure of whether the agent improved during the run.

### Stability

How frequently and how dramatically the model changes its strategy.

A model that changes all three values after every hand may be unstable.

### Oscillation

How often a model reverses a recent decision.

For example:

- Bluff rate 0.30 → 0.80
- Bluff rate 0.80 → 0.20
- Bluff rate 0.20 → 0.75

That pattern is useful evidence that the model may be overreacting to noise.

### Calibration

Whether the model knows when evidence is insufficient.

A model that says “no change” after one ambiguous hand may demonstrate better judgement than a model that makes a dramatic update after every result.

---

## 12. Do Not Babysit the Models

The system should not hide poor model behaviour.

If a model makes chaotic changes, that is a result of the experiment.

The system should enforce only mechanical safety.

### Mechanical validation

- Response must follow the expected structure
- Strategy fields must be recognised
- Strategy values must remain between 0 and 1
- Missing or malformed outputs are rejected
- Requests have timeouts and token limits
- The poker engine enforces legal actions
- If a model fails, the existing strategy remains unchanged

### Strategic decisions left to the model

The model decides:

- Whether to change anything
- Which parameter or parameters to change
- How large the change should be
- Whether one hand is enough evidence
- Whether recent results are likely to be luck
- Whether to reverse a previous change
- How to explain the decision

There should be no artificial rule such as:

- “A parameter can move only 20%”
- “The model cannot update after one hand”
- “The model may change only one value”
- “A simulator must approve the change”
- “The model cannot reverse itself”

Those rules would mean the developers are designing the intelligence rather than evaluating the model.

---

## 13. The Reflection Input

After every hand, each model receives a compact structured summary.

The input should include:

### Identity and current state

- Agent name
- Assigned model
- Current chip count
- Current strategy values

### Latest hand

- Hand ID
- Private hand strength or strength score
- Public cards
- Agent’s actions
- Opponents’ actions
- Whether the agent bluffed
- Whether the bluff succeeded
- Whether the agent reached showdown
- Chips gained or lost
- Winner of the hand

### Cumulative statistics

- Net chip result
- Bluff success rate
- Fold rate
- Call rate
- Raise rate
- Showdown win rate
- Opponent-specific fold and call behaviour

### Evolution history

- Previous strategy values
- Previous model decisions
- Reasons previously given
- Whether performance improved or worsened afterwards

The model should not receive a huge transcript. Keep the context compact, consistent, and cheap.

---

## 14. The Reflection Output

The model returns:

- Whether it wants to change the strategy
- New aggression value
- New bluff-rate value
- New call-threshold value
- A short explanation
- Evidence references, such as hand IDs
- Optional confidence score

The model may leave all values unchanged.

The explanation should be concise and public-facing. Do not request or display hidden chain-of-thought.

Example evolution event:

- Agent: DeepSeek Player
- Hand: 3
- Aggression: 0.50 → 0.50
- Bluff rate: 0.30 → 0.15
- Call threshold: 0.50 → 0.50
- Reason: Both weak-hand raises were called, while opponents folded only once to pressure.
- Evidence: Hand 2 and Hand 3

---

## 15. Full Runtime Pipeline

### Step 1: Initialise the tournament

The system creates three players.

Each player receives:

- A unique Band identity
- A model assignment through Pioneer
- The same starting strategy
- An empty evolution history
- A seat at the table

The deterministic dealer starts the seeded game.

### Step 2: Deal a hand

The engine:

- Shuffles using a fixed seed
- Deals private cards
- Reveals community cards
- Calculates legal actions
- Maintains the pot and chip balances

### Step 3: Route turns through Band

The dealer sends the active player only the information that player is allowed to see.

The player identity responds with its action.

The action itself is calculated locally from the deterministic strategy engine.

Band provides:

- Persistent agent identities
- Turn-by-turn communication
- A visible communication trace
- Clear separation between the dealer and the players

### Step 4: Update the frontend

The spectator sees:

- Cards
- Pot
- Chip counts
- Active player
- Fold, call, or raise animation
- Short public rationale
- Hand timeline

### Step 5: Resolve the hand

The engine:

- Determines the winner
- Moves chips
- Records every action
- Updates all metrics
- Produces a compact hand summary

### Step 6: Run three Pioneer reflections

After the hand, the three model calls can run concurrently because each player’s update depends only on the completed hand and its own state.

Parallel execution reduces waiting time.

Parallel execution does not increase the number of calls. The total remains exactly three calls per hand.

Each model decides whether and how to update its strategy.

### Step 7: Validate and apply updates

The system mechanically validates each response.

Valid updates are applied immediately.

Invalid responses or timeouts result in no strategy change.

No strategic approval layer is used.

### Step 8: Stream evolution events

The frontend shows:

- Old values
- New values
- Explanation
- Evidence
- Model name
- Latency
- Estimated cost

### Step 9: Play the next hand

The deterministic engine uses the updated strategy values.

If a strategy change matters, the audience should see different behaviour in a similar later situation.

### Step 10: Finish and publish

After six hands, the system:

- Displays final standings
- Calculates adaptation and stability metrics
- Generates the full evolution report
- Publishes a report to `cited.md`
- Makes the full audit pack available through an x402-protected endpoint

---

## 16. What the User Sees

The frontend should be one polished spectator page, not a full poker application.

### Top header

Show:

- Evolving Poker logo or title
- Tournament status
- Current hand, such as Hand 3 of 6
- Total Pioneer calls
- Estimated total cost
- Play, pause, and speed controls

### Main left panel: poker table

Show:

- A casino-style poker table
- Three player seats
- Player names
- Model names
- Chip stacks
- Private cards
- Community cards
- Pot
- Current action
- Dealer marker
- Small strategy indicators

The spectator may see all cards.

The agents themselves receive only the information appropriate to their seat.

### Main right panel: evolution log

This is the most important panel.

Every update appears as a readable card or diff:

- Which model changed
- Which hand triggered the reflection
- Previous values
- New values
- Short reason
- Evidence
- Latency
- Cost

Example:

**DeepSeek Player — Strategy Update after Hand 3**

- Aggression: 0.50 → 0.55
- Bluff rate: 0.30 → 0.10
- Call threshold: 0.50 → 0.45

Reason: Opponents called both weak raises, but folded to strong pressure.

Evidence: Hands 2 and 3

### Bottom section: analytics

Show compact model cards containing:

- Current chip count
- Adaptation gain
- Bluff success
- Strategy volatility
- Number of no-change decisions
- Average latency
- Estimated cost

### Optional tabs or drawers

If time allows:

- Full hand history
- Current strategy
- Previous strategies
- Band communication trace
- Final `cited.md` report
- Replay QA status

---

## 17. Visual Direction

The design should feel like a hybrid of:

- Premium online poker table
- AI laboratory
- Live sports broadcast
- Model-evaluation dashboard

Suggested visual direction:

- Dark felt or deep charcoal table
- Clear, high-contrast cards
- One accent colour per model
- Monospaced numbers for metrics
- Bright but restrained evolution diffs
- Smooth chip and card transitions
- Minimal text on the table
- More detailed explanations in the side panel

The table creates emotional engagement.

The evolution panel provides the technical substance.

Do not clutter the interface with every internal statistic at once.

---

## 18. Sponsor Strategy

### Primary target: Pioneer

Pioneer should be the primary prize track.

The project naturally demonstrates:

- Multiple model routing
- Different models receiving the same type of task
- Latency comparison
- Cost comparison
- Structured inference
- Adaptive behaviour
- A clear reason to compare cheap and stronger models

Do not attempt model fine-tuning during a four-hour event.

Use Pioneer for inference and routing only.

The core Pioneer story is:

> Three models receive the same evolving poker evidence. We compare which model adapts best, fastest, and cheapest.

### Band

Band is used as the communication and orchestration layer.

Its role should be genuine:

- Dealer has its own identity
- Each poker player has its own identity
- Dealer routes turns to the correct player
- Hand summaries and evolution events are communicated through the system
- The event trace can be shown to judges

The Band story is:

> Band provides the multi-agent table: separate identities, controlled message routing, and an auditable communication history.

### Replay

Replay is not the dashboard framework.

Replay is used to test the dashboard.

Create a deterministic fixture mode so Replay can test the frontend without spending Pioneer credits.

Replay should verify:

- Tournament starts
- Hand progression works
- Chip totals remain conserved
- Action timeline updates
- Evolution cards appear
- Final standings render
- Deterministic replay gives the same result
- Bugs discovered during QA were fixed

The Replay story is:

> Replay verified the spectator SaaS interface, found bugs, and confirmed that the final tournament experience works reliably.

### Tools deliberately not prioritised

Do not force Guild, Actian, or Senso into the MVP merely to collect integrations.

They may be useful later, but they add complexity without strengthening the four-hour core.

Three genuine sponsor integrations are better than six shallow ones.

---

## 19. `cited.md` Publication

The final tournament report should be published to `cited.md`.

The report is grounded in the game’s own event log.

Every claim should reference specific hand IDs.

Suggested report sections:

### Tournament summary

- Models
- Final chip counts
- Winner
- Total hands
- Total model calls
- Estimated total cost

### Evolution timeline

For every model:

- Starting strategy
- Strategy after each hand
- Explanation
- Evidence hand IDs

### Behavioural findings

Examples:

- Model A changed strategy after every hand.
- Model B returned “no change” three times.
- Model C repeatedly reversed bluff rate.
- Model A had the best chip result.
- Model B had the lowest cost.
- Model C showed the greatest second-half improvement.

### Evidence

Each insight links back to:

- Hand record
- Action history
- Strategy snapshot
- Pioneer response metadata

The report should not pretend that six hands provide scientific proof. Use language such as:

- “In this tournament”
- “During this run”
- “Observed in the six-hand demonstration”

---

## 20. Monetisation Through x402

The challenge requires agent payment rails.

The fastest viable monetisation layer is a paid endpoint for the full tournament audit pack.

### Free output

The public frontend and `cited.md` report show:

- Final standings
- High-level strategy changes
- Selected evidence

### Paid output

An x402-protected endpoint returns:

- Full hand-by-hand event log
- Every strategy snapshot
- Every model reflection
- Token and cost data
- Latency data
- Band communication trace
- Downloadable audit report

The requesting agent receives a payment-required response, pays through the test payment rail, and then receives the report.

A future product could charge to submit another model into the arena, but that should not be part of the four-hour MVP.

---

## 21. Cost Control

Cost must be treated as a product requirement.

### Hard call budget

For the six-hand MVP:

- Three models
- One reflection per model per hand
- Six hands
- Eighteen total LLM calls

There are no LLM calls for ordinary poker moves.

### Token limits

Each reflection should use:

- Compact structured input
- No full transcript
- Short output
- No hidden chain-of-thought request
- One concise public explanation

Suggested operational limits:

- Fewer than roughly 1,000 input tokens per reflection
- Fewer than roughly 150 output tokens per reflection
- One retry at most
- Strict timeout
- No recursive agent calls

### Model selection

Prioritise:

- Cheap serverless models
- Fast response time
- Reliable JSON or structured output

Candidate families may include Qwen, DeepSeek, GPT-OSS, or other inexpensive models offered through Pioneer.

The exact choice should be made after confirming hackathon credits.

### Failure behaviour

If a model times out or produces invalid output:

- Keep the current strategy
- Log the failure
- Continue the tournament
- Do not stop the demo

### Fixture mode

Frontend work and Replay testing should use saved tournament fixtures.

This prevents QA from spending model credits.

---

## 22. Fairness and Poker Luck

Different players receive different cards.

Therefore, a single six-hand tournament is not a perfect comparison of model quality.

### Core hackathon approach

Be transparent that the live tournament is a demonstration, not a statistically conclusive benchmark.

### Optional fairness extension

If time allows, run duplicate seeded tournaments and rotate the models between seats.

For example:

- Tournament 1: Model A sits in Seat 1
- Tournament 2: Model B receives Seat 1’s card sequence
- Tournament 3: Model C receives Seat 1’s card sequence

This reduces seat and card bias.

It should be treated as a stretch goal, not a core dependency.

---

## 23. Four-Developer Split

The team should work in parallel with clear interfaces.

### Developer 1: Game engine and metrics

Responsibilities:

- Simplified poker rules
- Seeded deck
- Dealing
- Betting state
- Legal actions
- Pot and chip accounting
- Hand evaluator integration
- Deterministic action function
- Hand summaries
- Performance and opponent metrics
- Fixture generation

Interface delivered to the team:

- Start tournament
- Advance hand
- Read current table state
- Read completed hand summary
- Apply strategy update

### Developer 2: Pioneer and evolution layer

Responsibilities:

- Pioneer model configuration
- Assign one model to each player
- Reflection prompt
- Compact model input
- Structured response parsing
- Mechanical validation
- Strategy application
- Token, latency, and cost logging
- Failure fallback
- Evolution event format

Interface delivered to the team:

- Reflect after hand
- Return validated strategy update or no change
- Return model metadata

### Developer 3: Band and output integrations

Responsibilities:

- Dealer identity
- Three player identities
- Turn routing
- Hand-summary communication
- Event trace
- Integration between Band and game state
- `cited.md` report publishing
- Minimal x402-protected audit endpoint

This developer should keep payment and publishing intentionally small.

### Developer 4: Frontend and Replay QA

Responsibilities:

- Poker-table spectator interface
- Player seats
- Cards, chips, pot, and actions
- Evolution side panel
- Model-comparison metrics
- Final standings
- Playback controls
- Deterministic fixture mode
- Replay test journeys
- Visual polish

### Shared responsibility

All developers help with:

- Final integration
- Demo seed selection
- Submission copy
- Ninety-second presentation
- Bug fixing during the final hour

---

## 24. Four-Hour Build Plan

Because four developers work in parallel, the timeline should focus on integration checkpoints rather than sequential ownership.

### First 45 minutes

- Developer 1 builds minimal engine and fixture output
- Developer 2 connects one Pioneer model and produces one valid reflection
- Developer 3 creates Band identities and proves one routed message
- Developer 4 builds the static table and evolution-panel layout

Checkpoint:

- One saved hand can render
- One model can return a strategy update
- One Band message can be sent
- The main page exists

### Minutes 45–105

- Engine completes one full simplified hand
- Pioneer layer supports all three models
- Band routes dealer-to-player events
- Frontend animates one hand from fixture data

Checkpoint:

- One live hand can complete
- Three models can reflect after it
- Strategy diffs can render

### Minutes 105–165

- Complete six-hand tournament loop
- Add metrics
- Add failure handling
- Connect live state to frontend
- Generate final standings

Checkpoint:

- Full live tournament runs without manual intervention

### Minutes 165–210

- Add `cited.md` report
- Add minimal x402 endpoint
- Add fixture mode
- Run Replay QA
- Fix discovered bugs

Checkpoint:

- All challenge requirements are visible

### Final 30 minutes

- Freeze features
- Select a reliable deterministic seed
- Rehearse demo
- Prepare fallback recording or fixture replay
- Verify sponsor integrations
- Verify costs and limits
- Prepare final pitch

---

## 25. Dependencies

### Required

- React or Next.js for the frontend
- Node.js or TypeScript for the game and backend
- Poker hand-evaluation library
- Pioneer account, API access, and hackathon credits
- Band SDK and agent credentials
- Replay account with hackathon access
- `cited.md` publishing method
- x402-compatible test payment setup

### Recommended

- Zod or another schema validator
- Simple in-memory state store
- JSON fixture files
- Lightweight animation library only if already familiar

### Avoid unless necessary

- PostgreSQL
- Redis
- Complex authentication
- User accounts
- Full deployment pipelines
- Large vector databases
- Fine-tuning workflows
- Heavy orchestration frameworks
- Real-money infrastructure

For the hackathon, in-memory state plus saved JSON fixtures is sufficient.

---

## 26. Demo Script

The live demo should take approximately ninety seconds.

### Opening

“Evolving Poker compares how different AI models learn from noisy feedback.”

### Show the table

Point out:

- Three models
- Same starting strategy
- Same game rules
- Fixed model weights
- Strategy memory changes after every hand

### Play the first hands

Let the audience see:

- A bluff
- A call
- A fold
- Chips move

### Show evolution

After the hand, three model reflections appear.

One model changes bluff rate.

Another changes aggression.

Another says no change because the evidence is weak.

### Show changed behaviour

In a later similar situation, show that an updated strategy leads to a different action.

### Show model comparison

Display:

- Chips
- Adaptation gain
- Stability
- Oscillation
- Latency
- Cost

Make the comparison memorable:

> “The strongest model won more chips, but the smaller model adapted almost as well at a fraction of the cost.”

Use the actual result rather than scripting a false conclusion.

### Show sponsor integrations

- Open Band trace
- Show Pioneer model metadata
- Show Replay QA status

### Show required outputs

- Open `cited.md` report
- Demonstrate the x402-protected full audit endpoint

### Closing

“Evolving Poker is a visual benchmark for how models adapt, not just how they answer a single prompt.”

---

## 27. Success Criteria

The project is successful if:

- Three agents complete a six-hand tournament
- Strategies update after every hand
- Models are allowed to choose no change
- Every update is visible and auditable
- At least one later action changes because of an earlier strategy update
- Total model calls remain capped at eighteen
- Pioneer, Band, and Replay are genuinely used
- The tournament report is published to `cited.md`
- The paid endpoint demonstrates an agent payment rail
- The entire demo can run reliably in under two minutes

The project does not need to prove that one model is universally better.

It needs to make adaptation visible and measurable.

---

## 28. Risks and Fallbacks

### Risk: Pioneer latency

Mitigation:

- Run the three post-hand reflections concurrently
- Use small models
- Use short prompts
- Add strict timeouts
- Keep strategy unchanged on failure

### Risk: Invalid structured output

Mitigation:

- Use schema validation
- Retry once
- Fall back to no change
- Log the failure as a model metric

### Risk: Poker engine bugs

Mitigation:

- Simplify rules
- Use an existing hand evaluator
- Add chip-conservation tests
- Use seeded fixtures
- Avoid side pots and all-ins

### Risk: Band integration consumes too much time

Mitigation:

- Keep the communication pattern minimal
- One dealer room
- Three named players
- One message per turn and one summary per hand
- Maintain a local fallback for the demo while still completing a real Band path

### Risk: Replay cannot test live model calls reliably

Mitigation:

- Use deterministic fixture mode
- Replay tests the interface, not external model variability

### Risk: No visible learning occurs

Mitigation:

- Choose a seeded sequence that creates repeated strategic situations
- Do not hard-code model conclusions
- Rehearse with the selected models
- Keep a saved successful tournament fixture as fallback

### Risk: Models make chaotic updates

This is not necessarily a bug.

Measure it as:

- Instability
- Oscillation
- Poor calibration

The project is designed to reveal differences in model judgement.

### Risk: The result looks like only a game

Mitigation:

- Keep the evolution panel permanently visible
- Display model cost, latency, and strategy changes
- Frame poker as the experimental environment
- End with comparative evaluation results

---

## 29. Claims to Make Carefully

### Safe claims

- The agents update external strategy state after every hand.
- The models receive real game outcomes.
- Every strategy change is visible.
- The models stay fixed while memory and strategy evolve.
- The system measures adaptation, stability, cost, and latency.
- The project compares how different models react to noisy feedback.

### Claims to avoid

- “The models truly learn like humans.”
- “This proves Model A is the best poker model.”
- “This is the first AI poker project.”
- “The agents become optimal.”
- “Six hands provide statistically significant results.”
- “The strategy changes are equivalent to training.”
- “The project is a production-ready poker system.”

---

## 30. Prior-Art and Novelty Positioning

AI poker agents and poker-based model evaluation already exist in various forms.

Therefore, the project should not rely on novelty claims such as:

> “No one has ever made AI agents play poker.”

The hackathon novelty is the combination of:

- Live cross-model comparison
- External strategy evolution after every hand
- Readable strategy diffs
- No hidden strategic guardrails
- Stability and oscillation metrics
- Cost and latency comparison
- Multi-agent orchestration through Band
- Pioneer-based model routing
- Replay-tested spectator SaaS interface
- `cited.md` audit report
- Paid machine-readable output

The strongest framing is:

> Evolving Poker is an auditable arena for evaluating how models adapt to repeated, noisy outcomes.

---

## 31. Future Extensions

These are not part of the four-hour MVP.

### More models

Run larger tournaments with more models after cost and stability are understood.

### Duplicate tournaments

Rotate models through the same seeded seats for fairer comparisons.

### Human player

Allow a human to enter the table and see how agents adapt to real behaviour.

### Custom model entry

Charge agents to submit a model or policy into the arena.

### Other environments

Use the same evolution framework for:

- Negotiation
- Auctions
- Resource allocation
- Trading simulations
- Repeated pricing games
- Cyber-defence simulations

### Richer strategy state

Add opponent-specific strategy values after the three global values are stable.

### Long-term memory

Persist strategy history across tournaments.

### Pioneer fine-tuning

Use tournament histories to fine-tune or route models later, once the core benchmark exists.

---

## 32. Final One-Paragraph Pitch

Evolving Poker is a live arena where three AI models play a simplified poker game and update their strategies after every hand. The poker engine makes deterministic in-game decisions from three evolving values: aggression, bluff rate, and call threshold. After each hand, the models study the outcome and decide whether those values should change. The system does not protect them from bad strategic decisions; overreaction, instability, and hesitation are part of what it measures. A spectator dashboard shows the game, every strategy diff, chip performance, adaptation gain, model latency, and inference cost. Pioneer powers the three model reflections, Band coordinates the agent identities and table communication, Replay tests the web experience, the tournament report is published to `cited.md`, and the complete audit trail is sold through an x402-protected endpoint.

---

## 33. Final One-Line Pitch

> **Evolving Poker is a live benchmark that shows how different AI models adapt to noisy feedback—one hand, one strategy update, and one readable diff at a time.**
