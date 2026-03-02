// stub - not available in browser


/* ------------------------------------------------------------------ */
/*  WASI class                                                         */
/* ------------------------------------------------------------------ */

export interface WASI {
  readonly wasiImport: Record<string, Function>;
  start(_instance: object): number;
  initialize(_instance: object): void;
  getImportObject(): Record<string, Record<string, Function>>;
}

interface WASIConstructor {
  new (_options?: object): WASI;
  (this: any, _options?: object): void;
  prototype: any;
}

export const WASI = function WASI(this: any, _options?: object) {
  if (!this) return;
  this.wasiImport = {};
} as unknown as WASIConstructor;

WASI.prototype.start = function start(_instance: object): number {
  throw new Error("WASI is not supported in the browser environment");
};

WASI.prototype.initialize = function initialize(_instance: object): void {
  throw new Error("WASI is not supported in the browser environment");
};

WASI.prototype.getImportObject = function getImportObject(this: any): Record<string, Record<string, Function>> {
  return { wasi_snapshot_preview1: this.wasiImport };
};

/* ------------------------------------------------------------------ */
/*  Default export                                                     */
/* ------------------------------------------------------------------ */

export default {
  WASI,
};
