import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { createReadStream, existsSync, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = resolve(here, "..");
const fixturesDir = resolve(repoRoot, "fixtures");

/**
 * The tournament recorder writes fixtures to <repoRoot>/fixtures, which sits
 * outside the Vite root, so serve that directory at /fixtures explicitly.
 */
function serveFixture(
  req: IncomingMessage,
  res: ServerResponse,
  next: () => void,
): void {
  const url = req.url ?? "";
  if (!url.startsWith("/fixtures/")) return next();
  const rel = decodeURIComponent(url.split("?")[0].slice("/fixtures/".length));
  if (!rel || rel.includes("..")) return next();
  const file = resolve(fixturesDir, rel);
  if (!file.startsWith(fixturesDir)) return next();
  if (!existsSync(file) || !statSync(file).isFile()) return next();
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  createReadStream(file).pipe(res);
}

function repoFixtures(): Plugin {
  return {
    name: "evolving-poker:repo-fixtures",
    configureServer(server) {
      server.middlewares.use(serveFixture);
    },
    configurePreviewServer(server) {
      server.middlewares.use(serveFixture);
    },
  };
}

export default defineConfig({
  plugins: [react(), repoFixtures()],
  server: {
    port: 5173,
    strictPort: false,
    proxy: {
      "/api": {
        target: "http://localhost:8787",
        changeOrigin: true,
      },
      "/ws": {
        target: "ws://localhost:8787",
        ws: true,
        changeOrigin: true,
      },
    },
  },
  preview: {
    port: 4173,
    proxy: {
      "/api": { target: "http://localhost:8787", changeOrigin: true },
      "/ws": { target: "ws://localhost:8787", ws: true, changeOrigin: true },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});
