import type { ConnectionState } from "../hooks/useTournamentStream";
import type { StreamMode } from "../lib/protocol";

interface Props {
  connection: ConnectionState;
  mode: StreamMode;
  onLoadOffline: () => void;
}

function describe(connection: ConnectionState, mode: StreamMode): string {
  if (connection === "connecting") return "Connecting to the tournament server…";
  if (connection === "reconnecting")
    return "Lost the tournament server. Retrying, and looking for a recorded fixture.";
  if (connection === "waiting")
    return "No live server and no recorded fixture found. Start the server, or drop a fixture at /fixtures/demo.json.";
  if (mode === "offline") return "Replaying a recorded fixture…";
  return "Connected. Waiting for the tournament to start.";
}

export function EmptyState({ connection, mode, onLoadOffline }: Props) {
  return (
    <div className="empty">
      <div className="empty__inner">
        <h2 className="empty__title">AWAITING TOURNAMENT</h2>
        <p className="empty__body">{describe(connection, mode)}</p>
        <p className="empty__meta mono">
          3 models · 6 hands · 18 reflections · 3 dials each
        </p>
        <button type="button" className="ctl" onClick={onLoadOffline}>
          Load recorded demo
        </button>
      </div>
    </div>
  );
}
