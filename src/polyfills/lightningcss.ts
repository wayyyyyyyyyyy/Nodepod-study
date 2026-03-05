// Lazy-loads lightningcss-wasm from CDN since native .node binaries can't run in browser.
// Feature flags are inlined for synchronous access; actual transform/bundle delegates to WASM.

import { CDN_LIGHTNINGCSS_WASM, cdnImport } from "../constants/cdn-urls";

// Bitfield constants -- must be available synchronously before WASM loads

export const Features = {
  Nesting:                        1,
  NotSelectorList:                2,
  DirSelector:                    4,
  LangSelectorList:               8,
  IsSelector:                    16,
  TextDecorationThicknessPercent: 32,
  MediaIntervalSyntax:           64,
  MediaRangeSyntax:             128,
  CustomMediaQueries:           256,
  ClampFunction:                512,
  ColorFunction:               1024,
  OklabColors:                 2048,
  LabColors:                   4096,
  P3Colors:                    8192,
  HexAlphaColors:             16384,
  SpaceSeparatedColorNotation: 32768,
  FontFamilySystemUi:         65536,
  DoublePositionGradients:   131072,
  VendorPrefixes:            262144,
  LogicalProperties:         524288,
  LightDark:                1048576,
  // Composite flags
  Selectors:                     31,
  MediaQueries:                 448,
  Colors:                   1113088,
} as const;

let wasmMod: any = null;
let initPromise: Promise<void> | null = null;

async function ensureInit(): Promise<void> {
  if (wasmMod) return;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      const mod = await cdnImport(CDN_LIGHTNINGCSS_WASM);
      if (typeof mod.default === "function") {
        await mod.default();
      } else if (typeof mod.init === "function") {
        await mod.init();
      }
      wasmMod = mod;
    } catch (err) {
      initPromise = null;
      throw new Error(`lightningcss: WASM initialization failed -- ${err}`);
    }
  })();

  return initPromise;
}

const canEagerInit =
  typeof window !== "undefined" &&
  typeof window.document !== "undefined";

// Eagerly warm in browser environments. In Node/test contexts, skip eager
// startup to avoid unhandled dynamic-import failures.
if (canEagerInit) {
  ensureInit().catch(() => {
    // Lazy callers (init/bundleAsync) will retry and surface actionable errors.
  });
}

export function transform(opts: any): any {
  if (!wasmMod) throw new Error("lightningcss: WASM not ready yet — call await init() first");
  return wasmMod.transform(opts);
}

export function transformStyleAttribute(opts: any): any {
  if (!wasmMod) throw new Error("lightningcss: WASM not ready yet");
  return wasmMod.transformStyleAttribute(opts);
}

export function bundle(opts: any): any {
  if (!wasmMod) throw new Error("lightningcss: WASM not ready yet");
  return wasmMod.bundle(opts);
}

export async function bundleAsync(opts: any): Promise<any> {
  await ensureInit();
  return wasmMod.bundleAsync(opts);
}

export function composeVisitors(visitors: any[]): any {
  if (!wasmMod) throw new Error("lightningcss: WASM not ready yet");
  return wasmMod.composeVisitors(visitors);
}

export function browserslistToTargets(browserslist: any): any {
  if (wasmMod?.browserslistToTargets) return wasmMod.browserslistToTargets(browserslist);
  return {};
}

export { ensureInit as init };

export default {
  transform,
  transformStyleAttribute,
  bundle,
  bundleAsync,
  composeVisitors,
  Features,
  browserslistToTargets,
  init: ensureInit,
};
