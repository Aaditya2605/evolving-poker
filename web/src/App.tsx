import { useCallback } from "react";
import { ComparisonStrip } from "./components/ComparisonStrip";
import { Drawers } from "./components/Drawers";
import { EmptyState } from "./components/EmptyState";
import { EvolutionLog } from "./components/EvolutionLog";
import { Header } from "./components/Header";
import { StandingsRibbon } from "./components/StandingsRibbon";
import { Table } from "./components/Table";
import { useTournamentStream } from "./hooks/useTournamentStream";
import { totalCostUsd, totalLlmCalls } from "./state/reducer";

export default function App() {
  const {
    state,
    mode,
    connection,
    paused,
    speed,
    fixtureTrace,
    setPaused,
    setSpeed,
    loadOffline,
  } = useTournamentStream();

  const togglePause = useCallback(() => setPaused(!paused), [paused, setPaused]);

  const started = state.players.length > 0;

  return (
    <div className="app">
      <Header
        handId={state.handId}
        totalHands={state.totalHands}
        finished={state.phase === "finished"}
        llmCalls={totalLlmCalls(state)}
        costUsd={totalCostUsd(state)}
        mode={mode}
        connection={connection}
        paused={paused}
        speed={speed}
        onTogglePause={togglePause}
        onSpeed={setSpeed}
      />

      {started ? (
        <>
          <main className="app__table">
            {state.standings ? (
              <StandingsRibbon
                standings={state.standings}
                players={state.players}
              />
            ) : null}
            <Table state={state} />
          </main>

          <aside className="app__log">
            <EvolutionLog
              events={state.evolutions}
              players={state.players}
              waiting={state.handRecords.length === 0}
            />
          </aside>

          <footer className="app__strip">
            <ComparisonStrip
              players={state.players}
              chips={state.chips}
              metrics={state.metrics}
              evolutions={state.evolutions}
            />
          </footer>
        </>
      ) : (
        <main className="app__empty">
          <EmptyState
            connection={connection}
            mode={mode}
            onLoadOffline={loadOffline}
          />
        </main>
      )}

      <Drawers
        handRecords={state.handRecords}
        players={state.players}
        fixtureTrace={fixtureTrace}
      />
    </div>
  );
}
