import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import type { TraceMessage } from "../../../shared/types";
import { FixturePlayer } from "../lib/fixturePlayer";
import { loadFixture, parseInbound, type StreamMode } from "../lib/protocol";
import { initialState, reducer, type UiState } from "../state/reducer";

export type ConnectionState =
  | "connecting"
  | "open"
  | "reconnecting"
  | "waiting"
  | "ended";

export interface StreamApi {
  state: UiState;
  mode: StreamMode;
  connection: ConnectionState;
  paused: boolean;
  speed: number;
  fixtureTrace: TraceMessage[] | null;
  setPaused: (paused: boolean) => void;
  setSpeed: (speed: number) => void;
  loadOffline: () => void;
}

const RETRY_BASE_MS = 400;
const RETRY_MAX_MS = 8000;
const FALLBACK_AFTER_ATTEMPTS = 2;

function resolveWsUrl(): string {
  const override = import.meta.env.VITE_WS_URL;
  if (typeof override === "string" && override.length > 0) return override;
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/ws`;
}

function readUrlOptions(): { forceOffline: boolean; labelMode: StreamMode | null } {
  const params = new URLSearchParams(window.location.search);
  const mode = params.get("mode");
  return {
    forceOffline: mode === "offline" || params.has("offline"),
    labelMode: mode === "replay" ? "replay" : null,
  };
}

function detachSocket(ws: WebSocket): void {
  ws.onopen = null;
  ws.onclose = null;
  ws.onerror = null;
  ws.onmessage = null;
  try {
    ws.close();
  } catch {
    // already closing
  }
}

export function useTournamentStream(): StreamApi {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [mode, setMode] = useState<StreamMode>("live");
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [paused, setPausedState] = useState(false);
  const [speed, setSpeedState] = useState(1);
  const [fixtureTrace, setFixtureTrace] = useState<TraceMessage[] | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const playerRef = useRef<FixturePlayer | null>(null);
  const speedRef = useRef(1);
  const pausedRef = useRef(false);
  const endedRef = useRef(false);
  const startFixtureRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    endedRef.current = state.phase === "finished";
  }, [state.phase]);

  const sendControl = useCallback(
    (action: "pause" | "play" | "speed", value: number) => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify({ type: "control", action, value }));
    },
    [],
  );

  const setPaused = useCallback(
    (next: boolean) => {
      pausedRef.current = next;
      setPausedState(next);
      const player = playerRef.current;
      if (player) {
        if (next) player.pause();
        else player.start();
      }
      sendControl(next ? "pause" : "play", speedRef.current);
    },
    [sendControl],
  );

  const setSpeed = useCallback(
    (next: number) => {
      speedRef.current = next;
      setSpeedState(next);
      playerRef.current?.setSpeed(next);
      sendControl("speed", next);
    },
    [sendControl],
  );

  const loadOffline = useCallback(() => {
    startFixtureRef.current?.();
  }, []);

  useEffect(() => {
    const { forceOffline, labelMode } = readUrlOptions();
    const wsUrl = resolveWsUrl();

    let disposed = false;
    let offline = false;
    let attempts = 0;
    let fixturePending = false;
    let retryTimer: number | null = null;

    const clearRetry = () => {
      if (retryTimer !== null) {
        window.clearTimeout(retryTimer);
        retryTimer = null;
      }
    };

    const startFixture = async (): Promise<void> => {
      if (disposed || offline || fixturePending) return;
      fixturePending = true;
      const fixture = await loadFixture();
      fixturePending = false;
      if (disposed || offline) return;
      if (!fixture) {
        setConnection((prev) => (prev === "open" ? prev : "waiting"));
        return;
      }

      offline = true;
      clearRetry();
      const ws = wsRef.current;
      wsRef.current = null;
      if (ws) detachSocket(ws);

      dispatch({ kind: "reset" });
      setFixtureTrace(fixture.trace);
      setMode("offline");
      setConnection("open");

      const player = new FixturePlayer(fixture.events, (event) =>
        dispatch({ kind: "event", event }),
      );
      player.setSpeed(speedRef.current);
      playerRef.current = player;
      if (!pausedRef.current) player.start();
    };

    startFixtureRef.current = () => {
      void startFixture();
    };

    const scheduleRetry = () => {
      if (disposed || offline) return;
      clearRetry();
      const delay = Math.min(
        RETRY_MAX_MS,
        RETRY_BASE_MS * Math.pow(2, Math.max(0, attempts - 1)),
      );
      retryTimer = window.setTimeout(() => {
        retryTimer = null;
        connect();
      }, delay);
    };

    const connect = () => {
      if (disposed || offline) return;

      let ws: WebSocket;
      try {
        ws = new WebSocket(wsUrl);
      } catch {
        attempts += 1;
        if (attempts >= FALLBACK_AFTER_ATTEMPTS) void startFixture();
        scheduleRetry();
        return;
      }

      wsRef.current = ws;
      setConnection(attempts === 0 ? "connecting" : "reconnecting");

      ws.onopen = () => {
        if (disposed) return;
        attempts = 0;
        dispatch({ kind: "reset" });
        setMode(labelMode ?? "live");
        setConnection("open");
        if (speedRef.current !== 1) {
          ws.send(
            JSON.stringify({
              type: "control",
              action: "speed",
              value: speedRef.current,
            }),
          );
        }
        if (pausedRef.current) {
          ws.send(
            JSON.stringify({
              type: "control",
              action: "pause",
              value: speedRef.current,
            }),
          );
        }
      };

      ws.onmessage = (evt: MessageEvent<unknown>) => {
        if (disposed) return;
        const message = parseInbound(evt.data);
        if (message.kind === "event") {
          dispatch({ kind: "event", event: message.event });
        } else if (message.kind === "mode") {
          setMode(message.mode);
        }
      };

      ws.onerror = () => {
        // a close event always follows; retry logic lives there
      };

      ws.onclose = () => {
        if (wsRef.current === ws) wsRef.current = null;
        if (disposed || offline) return;
        if (endedRef.current) {
          setConnection("ended");
          return;
        }
        attempts += 1;
        setConnection("reconnecting");
        if (attempts >= FALLBACK_AFTER_ATTEMPTS) void startFixture();
        scheduleRetry();
      };
    };

    if (forceOffline) {
      void startFixture().then(() => {
        if (!disposed && !offline) connect();
      });
    } else {
      connect();
    }

    return () => {
      disposed = true;
      clearRetry();
      startFixtureRef.current = null;
      playerRef.current?.stop();
      playerRef.current = null;
      const ws = wsRef.current;
      wsRef.current = null;
      if (ws) detachSocket(ws);
    };
  }, []);

  return {
    state,
    mode,
    connection,
    paused,
    speed,
    fixtureTrace,
    setPaused,
    setSpeed,
    loadOffline,
  };
}
