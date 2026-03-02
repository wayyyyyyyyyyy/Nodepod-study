// Rollup polyfill that lazy-loads @rollup/browser from CDN

import * as acorn from "acorn";
import acornJsx from "acorn-jsx";
import {
  CDN_ROLLUP_BROWSER,
  PINNED_ROLLUP_BROWSER,
  cdnImport,
} from "../constants/cdn-urls";

// acorn parser extended with JSX support
const acornJsxParser = (acorn.Parser as any).extend(acornJsx());

let cachedRollup: unknown = null;
let loadingPromise: Promise<unknown> | null = null;

async function ensureRollup(): Promise<unknown> {
  if (cachedRollup) return cachedRollup;
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    try {
      const mod = await cdnImport(CDN_ROLLUP_BROWSER);
      cachedRollup = mod;
      return mod;
    } catch (err) {
      loadingPromise = null;
      throw new Error(
        `rollup: failed to load @rollup/browser from CDN -- ${err}`,
      );
    }
  })();

  return loadingPromise;
}

export const VERSION: string = PINNED_ROLLUP_BROWSER;

// .write() is a no-op in browser
export async function rollup(inputOptions: unknown): Promise<unknown> {
  const r = (await ensureRollup()) as {
    rollup: (o: unknown) => Promise<unknown>;
  };
  return r.rollup(inputOptions);
}

export async function watch(watchOptions: unknown): Promise<unknown> {
  const r = (await ensureRollup()) as { watch: (o: unknown) => unknown };
  return r.watch(watchOptions);
}

export function defineConfig<T>(config: T): T {
  return config;
}

// falls back to acorn-jsx if plain acorn fails (e.g. JSX in source)
export function parseAst(
  source: string,
  opts?: { allowReturnOutsideFunction?: boolean; jsx?: boolean },
): unknown {
  const parseOpts = {
    ecmaVersion: "latest" as const,
    sourceType: "module" as const,
    allowReturnOutsideFunction: opts?.allowReturnOutsideFunction ?? false,
    locations: true,
  };

  if (opts?.jsx) {
    return acornJsxParser.parse(source, parseOpts);
  }

  try {
    return acorn.parse(source, parseOpts);
  } catch {
    return acornJsxParser.parse(source, parseOpts);
  }
}

export async function parseAstAsync(
  source: string,
  opts?: {
    allowReturnOutsideFunction?: boolean;
    jsx?: boolean;
    signal?: AbortSignal;
  },
): Promise<unknown> {
  return parseAst(source, {
    allowReturnOutsideFunction: opts?.allowReturnOutsideFunction,
    jsx: opts?.jsx,
  });
}

// prevents "unsupported platform" error when Rollup probes for native bindings
export function getPackageBase(): string {
  return "";
}

export { ensureRollup as loadRollup };

export interface Plugin {
  name: string;
  [key: string]: unknown;
}

export interface PluginContext {
  meta: { rollupVersion: string };
  parse: (code: string) => unknown;
  [key: string]: unknown;
}

export default {
  VERSION,
  rollup,
  watch,
  defineConfig,
  parseAst,
  parseAstAsync,
  loadRollup: ensureRollup,
};
