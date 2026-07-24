import { serve } from "@hono/node-server";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, resolve, sep } from "node:path";
import { Hono } from "hono";
import type { AuditPack, FinalStandings, TournamentEvent } from "../../shared/types.js";
import { Trace } from "./comm/trace.js";
import { createRouter } from "./comm/band.js";
import { config } from "./config.js";
import { runTournament } from "./engine/tournament.js";
import { createAdapter } from "./evolution/pioneer.js";
import { findSeeds } from "./find-seed.js";
import { Recorder, loadFixture, replayFixture, writeFixture } from "./fixtures.js";
import { generateCited, writeCited } from "./outputs/report.js";
import { mountAudit } from "./outputs/x402.js";
import { Broadcaster } from "./ws.js";

const ROOT = resolve(import.meta.dirname, "..", "..");

// --- args ------------------------------------------------------------------

function parseArgs(argv: string[]) {
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      flags[key] = next;
      i++;
    } else {
      flags[key] = true;
    }
  }
  return flags;
}

const str = (v: unknown, fallback: string) => (typeof v === "string" ? v : fallback);
const num = (v: unknown, fallback: number) => (typeof v === "string" ? Number(v) : fallback);

// --- shared app state ------------------------------------------------------

interface AppState {
  mode: "live" | "replay" | "idle";
  seed: string;
  running: boolean;
  standings: FinalStandings | null;
  cited: string | null;
  pack: AuditPack | null;
  trace: Trace;
}

const state: AppState = {
  mode: "idle",
  seed: "",
  running: false,
  standings: null,
  cited: null,
  pack: null,
  trace: new Trace(),
};

// --- http ------------------------------------------------------------------

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

/** Serves a file only if it resolves inside `root` — no traversal. */
function safeRead(root: string, relative: string): { body: ArrayBuffer; type: string } | null {
  const full = resolve(root, "." + (relative.startsWith("/") ? relative : `/${relative}`));
  if (full !== root && !full.startsWith(root + sep)) return null;
  if (!existsSync(full) || !statSync(full).isFile()) return null;
  const buf = readFileSync(full);
  return {
    body: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer,
    type: MIME[extname(full)] ?? "application/octet-stream",
  };
}

function buildApp(broadcaster: () => Broadcaster | null) {
  const app = new Hono();

  app.get("/api/state", (c) =>
    c.json({
      mode: state.mode,
      seed: state.seed,
      running: state.running,
      pioneerMode: config.pioneerMode,
      bandMode: config.bandMode,
      controls: broadcaster()?.controls ?? { paused: false, speed: 1 },
      hasStandings: !!state.standings,
    }),
  );

  app.get("/api/trace", (c) => c.json(state.trace.all()));

  app.get("/api/cited", (c) =>
    state.cited
      ? c.text(state.cited, 200, { "Content-Type": "text/markdown; charset=utf-8" })
      : c.text("# No report yet\n\nRun a tournament first.", 404),
  );

  mountAudit(app, () => state.pack);

  // Fixtures are fetched directly by the UI as its offline fallback.
  app.get("/fixtures/:name", (c) => {
    const file = safeRead(join(ROOT, "fixtures"), c.req.param("name"));
    if (!file) return c.notFound();
    return new Response(file.body, { status: 200, headers: { "Content-Type": file.type } });
  });

  // Built spectator app, when `npm run build` has been run.
  const dist = join(ROOT, "web", "dist");
  app.get("*", (c) => {
    if (!existsSync(dist)) {
      return c.text(
        "Spectator UI is not built. Run `npm run web` for the dev server, or `npm run build`.",
        200,
      );
    }
    const path = new URL(c.req.url).pathname;
    const file = safeRead(dist, path === "/" ? "/index.html" : path) ?? safeRead(dist, "/index.html");
    if (!file) return c.notFound();
    return new Response(file.body, { status: 200, headers: { "Content-Type": file.type } });
  });

  return app;
}

function startServer(): { broadcaster: Broadcaster; stop: () => void } {
  let b: Broadcaster | null = null;
  const app = buildApp(() => b);
  const server = serve({ fetch: app.fetch, port: config.port });
  server.on("error", (e: NodeJS.ErrnoException) => {
    if (e.code === "EADDRINUSE") {
      console.error(
        `\n  Port ${config.port} is already in use — another tournament or replay is still running.` +
          `\n  Stop it, or set PORT=<other> in your environment.\n`,
      );
      process.exit(1);
    }
    throw e;
  });
  b = new Broadcaster(server as never);
  console.log(`  http://localhost:${config.port}   (ws: /ws · audit: /audit)`);
  return {
    broadcaster: b,
    stop: () => {
      b?.close();
      (server as { close: () => void }).close();
    },
  };
}

// --- commands --------------------------------------------------------------

async function cmdTournament(flags: Record<string, string | boolean>) {
  // Default chosen by `npm run find-seed` over seeds 1..500, not by taste.
  const seed = str(flags.seed, "135");
  const hands = num(flags.hands, 6);
  const record = typeof flags.record === "string" ? resolve(ROOT, flags.record) : null;
  const headless = flags["no-serve"] === true;

  console.log(`\nEVOLVING POKER — seed "${seed}", ${hands} hands, Pioneer mode: ${config.pioneerMode}`);

  const server = headless ? null : startServer();
  if (server) {
    server.broadcaster.setMode("live");
    console.log("  waiting 1.5s for spectators to connect...");
    await new Promise((r) => setTimeout(r, 1500));
  }

  const recorder = new Recorder();
  const trace = new Trace();
  state.trace = trace;
  state.mode = "live";
  state.seed = seed;
  state.running = true;

  const result = await runTournament({
    seed,
    totalHands: hands,
    trace,
    router: createRouter(trace),
    adapter: createAdapter(1),
    gate: server?.broadcaster.gate,
    emit: (e: TournamentEvent) => {
      recorder.capture(e);
      server?.broadcaster.publish(e);
      logEvent(e);
    },
  });

  state.running = false;
  state.standings = result.standings;
  state.cited = generateCited(result.events, result.standings, {
    pioneerMode: config.pioneerMode,
    bandMode: config.bandMode,
    coercions: result.coercions,
  });
  state.pack = {
    seed,
    generatedAt: new Date().toISOString(),
    events: result.events,
    reflections: result.reflections,
    trace: trace.all(),
    standings: result.standings,
  };

  const citedPath = writeCited(state.cited, join(ROOT, "cited.md"));
  console.log(`\n  report → ${citedPath}`);

  if (record) {
    const p = writeFixture(record, seed, config.pioneerMode, recorder.timed, trace);
    console.log(`  fixture → ${p}`);
  }

  printSummary(result.standings);

  if (server) {
    console.log(`\n  Server still up. GET /audit for the paid pack. Ctrl-C to exit.`);
  }
}

async function cmdServe(flags: Record<string, string | boolean>) {
  const fixturePath = resolve(ROOT, str(flags.fixture, join(ROOT, "fixtures", "demo.json")));
  const speed = num(flags.speed, 1);
  const loop = flags.loop === true;

  const server = startServer();
  server.broadcaster.controls.speed = speed;

  if (!existsSync(resolve(fixturePath))) {
    console.log(`\n  No fixture at ${fixturePath}. Serving idle — run \`npm run demo\` to create one.`);
    return;
  }

  do {
    const fixture = loadFixture(fixturePath);
    state.mode = "replay";
    state.seed = fixture.seed;
    state.running = true;
    state.trace = new Trace();
    state.trace.load(fixture.trace);

    console.log(`\n  replaying ${fixture.events.length} events from seed "${fixture.seed}" at ${speed}x`);
    server.broadcaster.reset();
    server.broadcaster.setMode("replay");

    await replayFixture(fixture, {
      gate: server.broadcaster.gate,
      getSpeed: () => server.broadcaster.controls.speed,
      onEvent: (e) => {
        server.broadcaster.publish(e);
        logEvent(e);
        if (e.type === "tournament_end") {
          state.standings = e.standings;
          state.cited = generateCited(fixture.events.map((t) => t.event), e.standings, {
            pioneerMode: fixture.pioneerMode,
            bandMode: config.bandMode,
            coercions: [],
          });
          state.pack = {
            seed: fixture.seed,
            generatedAt: new Date().toISOString(),
            events: fixture.events.map((t) => t.event),
            reflections: [],
            trace: fixture.trace,
            standings: e.standings,
          };
        }
      },
    });

    state.running = false;
    console.log("  replay complete.");
  } while (loop);
}

async function cmdFindSeed(flags: Record<string, string | boolean>) {
  const limit = num(flags.limit, 500);
  const samples = typeof flags.samples === "string" ? Number(flags.samples) : undefined;
  console.log(
    `\nScanning seeds 1..${limit} with strategies frozen at neutral` +
      `${samples ? ` (Monte-Carlo ${samples} samples — approximate)` : " (exact hand strength)"}...\n`,
  );
  const scores = await findSeeds(limit, samples);
  console.log("\nTop 5 demo seeds:\n");
  for (const s of scores.slice(0, 5)) {
    console.log(
      `  ${s.seed.padStart(4)}  score ${String(s.score).padStart(3)}  ` +
        `bluffOpps ${s.earlyBluffOpportunities}  bluffs ${s.bluffsThrown}  ` +
        `similarSpots ${s.similarSpots}  earlyShowdowns ${s.earlyShowdowns}  ` +
        `winners ${s.distinctWinners}  minChips ${s.minChips}` +
        `${s.meetsAllCriteria ? "  ✓ all criteria" : `  (${s.notes.join("; ")})`}`,
    );
  }
  console.log(`\nUse one with:  npm run tournament -- --seed ${scores[0].seed}\n`);
}

// --- output helpers --------------------------------------------------------

function logEvent(e: TournamentEvent): void {
  if (e.type === "hand_start") {
    console.log(`\n  ── hand ${e.handId} ── board ${e.communityCards.join(" ")}  pot ${e.pot}`);
  }
  if (e.type === "action") {
    console.log(
      `     ${e.playerId} ${e.action}${e.amount ? ` ${e.amount}` : ""}${e.isBluff ? "  (bluff)" : ""}  → pot ${e.potAfter}`,
    );
  }
  if (e.type === "hand_end") {
    console.log(
      `     winner ${e.record.winner} takes ${e.record.potSize}${e.record.showdown.length ? " at showdown" : ""}`,
    );
  }
  if (e.type === "evolution") {
    const v = e.event;
    const tag = v.status === "applied" ? "CHANGED" : v.status.toUpperCase();
    console.log(`     [${tag}] ${v.playerId} (${v.model}) — ${v.reason.slice(0, 90)}`);
  }
}

function printSummary(standings: FinalStandings): void {
  console.log("\n  FINAL");
  for (const r of standings.ranking) {
    console.log(
      `    ${r.rank}. ${r.name.padEnd(8)} ${String(r.chips).padStart(5)}  (${r.netChips >= 0 ? "+" : ""}${r.netChips})  ${r.model}`,
    );
  }
  const t = standings.snapshot.totals;
  console.log(
    `\n  ${t.llmCalls} model calls · $${t.estCostUsd.toFixed(4)} · avg ${t.avgLatencyMs}ms · ` +
      `${t.invalid} invalid · ${t.timeouts} timeout`,
  );
}

// --- entry -----------------------------------------------------------------

const [, , command = "tournament", ...rest] = process.argv;
const flags = parseArgs(rest);

const run =
  command === "serve" ? cmdServe : command === "find-seed" ? cmdFindSeed : cmdTournament;

run(flags).catch((e) => {
  console.error(e);
  process.exit(1);
});
