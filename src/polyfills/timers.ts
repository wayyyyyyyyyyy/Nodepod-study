// Timer functions mapped to browser equivalents, includes setImmediate polyfill


export const setTimeout = globalThis.setTimeout;
export const setInterval = globalThis.setInterval;
export const setImmediate = (fn: (...args: unknown[]) => void, ...args: unknown[]) =>
  globalThis.setTimeout(fn, 0, ...args);
export const clearTimeout = globalThis.clearTimeout;
export const clearInterval = globalThis.clearInterval;
export const clearImmediate = globalThis.clearTimeout;

// timers/promises API
export const promises = {
  setTimeout: (ms: number, value?: unknown) =>
    new Promise((resolve) => globalThis.setTimeout(() => resolve(value), ms)),
  setInterval: globalThis.setInterval,
  setImmediate: (value?: unknown) =>
    new Promise((resolve) => globalThis.setTimeout(() => resolve(value), 0)),
  scheduler: {
    wait: (ms: number) =>
      new Promise((resolve) => globalThis.setTimeout(resolve, ms)),
  },
};

export default {
  setTimeout,
  setInterval,
  setImmediate,
  clearTimeout,
  clearInterval,
  clearImmediate,
};
