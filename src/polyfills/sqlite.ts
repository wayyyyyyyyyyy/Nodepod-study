// stub - not available in browser (would need sql.js WASM)


/* ------------------------------------------------------------------ */
/*  StatementSync                                                      */
/* ------------------------------------------------------------------ */

export interface StatementSync {
  run(..._params: unknown[]): object;
  get(..._params: unknown[]): unknown;
  all(..._params: unknown[]): unknown[];
  expandedSQL(): string;
  sourceSQL(): string;
}

interface StatementSyncConstructor {
  new (): StatementSync;
  (this: any): void;
  prototype: any;
}

export const StatementSync = function StatementSync(this: any) {
  if (!this) return;
} as unknown as StatementSyncConstructor;

StatementSync.prototype.run = function run(..._params: unknown[]): object {
  throw new Error("node:sqlite is not supported in the browser environment");
};
StatementSync.prototype.get = function get(..._params: unknown[]): unknown {
  throw new Error("node:sqlite is not supported in the browser environment");
};
StatementSync.prototype.all = function all(..._params: unknown[]): unknown[] {
  throw new Error("node:sqlite is not supported in the browser environment");
};
StatementSync.prototype.expandedSQL = function expandedSQL(): string {
  return "";
};
StatementSync.prototype.sourceSQL = function sourceSQL(): string {
  return "";
};

/* ------------------------------------------------------------------ */
/*  DatabaseSync                                                       */
/* ------------------------------------------------------------------ */

export interface DatabaseSync {
  close(): void;
  exec(_sql: string): void;
  prepare(_sql: string): StatementSync;
  open(): void;
}

interface DatabaseSyncConstructor {
  new (_location: string, _options?: object): DatabaseSync;
  (this: any, _location: string, _options?: object): void;
  prototype: any;
}

export const DatabaseSync = function DatabaseSync(this: any, _location: string, _options?: object) {
  if (!this) return;
  throw new Error("node:sqlite is not supported in the browser environment");
} as unknown as DatabaseSyncConstructor;

DatabaseSync.prototype.close = function close(): void {};
DatabaseSync.prototype.exec = function exec(_sql: string): void {};
DatabaseSync.prototype.prepare = function prepare(_sql: string): StatementSync {
  throw new Error("node:sqlite is not supported in the browser environment");
};
DatabaseSync.prototype.open = function open(): void {};

/* ------------------------------------------------------------------ */
/*  Default export                                                     */
/* ------------------------------------------------------------------ */

export default {
  DatabaseSync,
  StatementSync,
};
