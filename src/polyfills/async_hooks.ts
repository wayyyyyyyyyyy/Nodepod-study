// stub - AsyncLocalStorage uses a simple stack, rest is no-op


/* ------------------------------------------------------------------ */
/*  AsyncResource                                                      */
/* ------------------------------------------------------------------ */

export interface AsyncResource {
  runInAsyncScope<R>(fn: (...a: any[]) => R, thisArg?: unknown, ...args: any[]): R;
  emitDestroy(): this;
  asyncId(): number;
  triggerAsyncId(): number;
}

export const AsyncResource = function AsyncResource(this: any, _kind: string, _opts?: object) {
  if (!this) return;
} as unknown as { new(_kind: string, _opts?: object): AsyncResource; prototype: any; bind<F extends (...a: any[]) => any>(fn: F, _kind?: string): F };

AsyncResource.prototype.runInAsyncScope = function runInAsyncScope<R>(
  fn: (...a: any[]) => R,
  thisArg?: unknown,
  ...args: any[]
): R {
  return fn.apply(thisArg, args);
};
AsyncResource.prototype.emitDestroy = function emitDestroy() { return this; };
AsyncResource.prototype.asyncId = function asyncId(): number { return 0; };
AsyncResource.prototype.triggerAsyncId = function triggerAsyncId(): number { return 0; };

AsyncResource.bind = function bind<F extends (...a: any[]) => any>(fn: F, _kind?: string): F {
  return fn;
};

/* ------------------------------------------------------------------ */
/*  AsyncLocalStorage                                                  */
/* ------------------------------------------------------------------ */

export interface AsyncLocalStorage<T> {
  disable(): void;
  getStore(): T | undefined;
  run<R>(store: T, fn: (...args: any[]) => R, ...args: any[]): R;
  exit<R>(fn: (...args: any[]) => R, ...args: any[]): R;
  enterWith(store: T): void;
}

export const AsyncLocalStorage = function AsyncLocalStorage(this: any) {
  if (!this) return;
  this._store = undefined;
} as unknown as { new<T>(): AsyncLocalStorage<T>; prototype: any };

AsyncLocalStorage.prototype.disable = function disable(): void {};

AsyncLocalStorage.prototype.getStore = function getStore() {
  return this._store;
};

AsyncLocalStorage.prototype.run = function run(store: any, fn: (...args: any[]) => any, ...args: any[]) {
  const prev = this._store;
  this._store = store;
  try {
    const result = fn(...args);
    // For async functions, keep the store active until the promise settles
    if (result && typeof (result as any).then === "function") {
      (result as any).then(
        () => { this._store = prev; },
        () => { this._store = prev; },
      );
      return result;
    }
    this._store = prev;
    return result;
  } catch (e) {
    this._store = prev;
    throw e;
  }
};

AsyncLocalStorage.prototype.exit = function exit(fn: (...args: any[]) => any, ...args: any[]) {
  const prev = this._store;
  this._store = undefined;
  try {
    const result = fn(...args);
    if (result && typeof (result as any).then === "function") {
      (result as any).then(
        () => { this._store = prev; },
        () => { this._store = prev; },
      );
      return result;
    }
    this._store = prev;
    return result;
  } catch (e) {
    this._store = prev;
    throw e;
  }
};

AsyncLocalStorage.prototype.enterWith = function enterWith(store: any): void {
  this._store = store;
};

/* ------------------------------------------------------------------ */
/*  Hook API                                                           */
/* ------------------------------------------------------------------ */

export interface AsyncHook {
  enable(): AsyncHook;
  disable(): AsyncHook;
}

export function createHook(_callbacks: object): AsyncHook {
  const hook: AsyncHook = {
    enable() {
      return hook;
    },
    disable() {
      return hook;
    },
  };
  return hook;
}

export function executionAsyncId(): number {
  return 0;
}
export function executionAsyncResource(): object {
  return {};
}
export function triggerAsyncId(): number {
  return 0;
}

/* ------------------------------------------------------------------ */
/*  Default export                                                     */
/* ------------------------------------------------------------------ */

export default {
  AsyncResource,
  AsyncLocalStorage,
  createHook,
  executionAsyncId,
  executionAsyncResource,
  triggerAsyncId,
};
