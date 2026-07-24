import { useEffect, useRef, useState } from "react";
import type {
  HandRecord,
  PlayerId,
  PlayerState,
  TraceMessage,
} from "../../../shared/types";
import { fetchCited, fetchTrace } from "../lib/api";
import { fmtChips, fmtSigned } from "../lib/format";

type DrawerKey = "hands" | "trace" | "cited";

interface Props {
  handRecords: HandRecord[];
  players: PlayerState[];
  fixtureTrace: TraceMessage[] | null;
}

const TABS: { key: DrawerKey; label: string }[] = [
  { key: "hands", label: "Hand history" },
  { key: "trace", label: "Message trace" },
  { key: "cited", label: "cited.md" },
];

export function Drawers({ handRecords, players, fixtureTrace }: Props) {
  const [open, setOpen] = useState<DrawerKey | null>(null);
  const [trace, setTrace] = useState<TraceMessage[] | null>(fixtureTrace);
  const [cited, setCited] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const triedTrace = useRef(false);
  const triedCited = useRef(false);

  const nameOf = (id: PlayerId): string =>
    players.find((p) => p.id === id)?.name ?? id;

  useEffect(() => {
    if (fixtureTrace && fixtureTrace.length > 0) {
      setTrace(fixtureTrace);
      triedTrace.current = true;
    }
  }, [fixtureTrace]);

  useEffect(() => {
    let cancelled = false;

    if (open === "trace" && !triedTrace.current) {
      triedTrace.current = true;
      setLoading(true);
      void fetchTrace().then((result) => {
        if (cancelled) return;
        setTrace(result ?? []);
        setLoading(false);
      });
    }

    if (open === "cited" && !triedCited.current) {
      triedCited.current = true;
      setLoading(true);
      void fetchCited().then((result) => {
        if (cancelled) return;
        setCited(result ?? "");
        setLoading(false);
      });
    }

    return () => {
      cancelled = true;
    };
  }, [open]);

  return (
    <div className={`drawers${open ? " is-open" : ""}`}>
      <div className="drawers__tabs">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            className={`drawers__tab${open === tab.key ? " is-active" : ""}`}
            onClick={() => setOpen(open === tab.key ? null : tab.key)}
            aria-expanded={open === tab.key}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {open ? (
        <div className="drawers__panel">
          {open === "hands" ? (
            <div className="drawers__body">
              {handRecords.length === 0 ? (
                <p className="drawers__empty">No completed hands yet.</p>
              ) : (
                handRecords
                  .slice()
                  .reverse()
                  .map((record) => (
                    <div className="handrow" key={record.handId}>
                      <div className="handrow__head mono">
                        <strong>Hand {record.handId}</strong>
                        <span>{record.communityCards.join(" ")}</span>
                        <span>pot {fmtChips(record.potSize)}</span>
                        <span>
                          won by{" "}
                          {record.winners.map((id) => nameOf(id)).join(" & ")}
                        </span>
                      </div>
                      <div className="handrow__actions mono">
                        {record.actions.map((a, i) => (
                          <span className="handrow__action" key={i}>
                            {nameOf(a.playerId)} {a.action}
                            {a.amount > 0 ? ` ${a.amount}` : ""}
                            {a.isBluff ? " (bluff)" : ""}
                          </span>
                        ))}
                      </div>
                      <div className="handrow__deltas mono">
                        {players.map((p) => (
                          <span key={p.id} style={{ color: p.color }}>
                            {p.name} {fmtSigned(record.chipDeltas[p.id] ?? 0)}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))
              )}
            </div>
          ) : null}

          {open === "trace" ? (
            <div className="drawers__body">
              {loading ? (
                <p className="drawers__empty">Loading trace…</p>
              ) : !trace || trace.length === 0 ? (
                <p className="drawers__empty">
                  No trace available. The trace endpoint is served by the
                  tournament server, or bundled into a recorded fixture.
                </p>
              ) : (
                <table className="tracetable mono">
                  <thead>
                    <tr>
                      <th>seq</th>
                      <th>from</th>
                      <th>to</th>
                      <th>kind</th>
                      <th>payload</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trace.map((msg) => (
                      <tr key={msg.seq}>
                        <td>{msg.seq}</td>
                        <td>{msg.from}</td>
                        <td>{msg.to}</td>
                        <td>{msg.kind}</td>
                        <td className="tracetable__payload">
                          {JSON.stringify(msg.payload)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          ) : null}

          {open === "cited" ? (
            <div className="drawers__body">
              {loading ? (
                <p className="drawers__empty">Loading cited.md…</p>
              ) : cited ? (
                <pre className="cited mono">{cited}</pre>
              ) : (
                <p className="drawers__empty">
                  cited.md is generated at the end of the tournament.
                </p>
              )}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
