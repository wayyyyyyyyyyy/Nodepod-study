import { defineConfig } from "vite";
import topLevelAwait from "vite-plugin-top-level-await";
import wasm from "vite-plugin-wasm";
import { resolve } from "path";
import { readFileSync } from "fs";
import { build as esbuild } from "esbuild";

const pkg = JSON.parse(
  readFileSync(resolve(__dirname, "package.json"), "utf-8"),
);
// Only peer deps and Node.js builtins are external.
// Runtime deps (pako, acorn, etc.) are inlined so the bundle is self-contained
// and works in any environment (bundler, browser, etc.) without extra config.
const peerDeps = Object.keys(pkg.peerDependencies || {});
const allExternal = [
  ...peerDeps,
  /^node:/,
];

/**
 * Vite plugin that pre-bundles process-worker-entry.ts into a self-contained
 * JS string. This is necessary because consumers of nodepod (Next.js, Webpack,
 * etc.) can't resolve Vite-specific worker chunk URLs. Instead, we embed the
 * entire worker bundle as a string and create Blob URL workers at runtime.
 */
function inlineProcessWorkerPlugin() {
  const VIRTUAL_ID = "virtual:process-worker-bundle";
  const RESOLVED_ID = "\0" + VIRTUAL_ID;
  let workerBundle = "";

  return {
    name: "inline-process-worker",
    async buildStart() {
      const result = await esbuild({
        entryPoints: [resolve(__dirname, "src/threading/process-worker-entry.ts")],
        bundle: true,
        format: "iife",
        platform: "browser",
        target: "esnext",
        write: false,
        minify: false,
        sourcemap: false,
        // Don't externalize anything — the worker must be fully self-contained
      });
      workerBundle = result.outputFiles[0].text;
    },
    resolveId(id) {
      if (id === VIRTUAL_ID) return RESOLVED_ID;
    },
    load(id) {
      if (id === RESOLVED_ID) {
        return `export const PROCESS_WORKER_BUNDLE = ${JSON.stringify(workerBundle)};`;
      }
    },
  };
}

export default defineConfig({
  plugins: [wasm(), topLevelAwait(), inlineProcessWorkerPlugin()],
  worker: {
    format: "es",
    rollupOptions: {
      external: allExternal,
    },
  },
  build: {
    lib: {
      entry: {
        index: resolve(__dirname, "src/index.ts"),
      },
      formats: ["es", "cjs"],
      fileName: (format, entryName) => {
        const ext = format === "es" ? "mjs" : "cjs";
        return `${entryName}.${ext}`;
      },
    },
    rollupOptions: {
      external: allExternal,
    },
    sourcemap: true,
    minify: false,
  },
});
