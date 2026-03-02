// Event loop ref-counting, mirroring Node.js/libuv semantics.
// Process stays alive while refCount > 0 (servers, readline, child procs).
// Supports both global mode and per-ProcessContext mode.

import type { ProcessContext } from "../threading/process-context";
import { getActiveContext } from "../threading/process-context";

/* ---- Global state (fallback when no ProcessContext) ---- */

let _refCount = 0;
const _drainListeners = new Set<() => void>();

function effectiveDrainListeners(): Set<() => void> {
  const ctx = getActiveContext();
  return ctx?.drainListeners ?? _drainListeners;
}

/* ---- Public API ---- */

export function addDrainListener(cb: () => void): () => void {
  const listeners = effectiveDrainListeners();
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function notifyDrain(): void {
  const ctx = getActiveContext();
  if (ctx) {
    for (const cb of ctx.drainListeners) cb();
  }
  // Always notify global too (ProcessManager observers)
  for (const cb of _drainListeners) cb();
}

export function ref(): void {
  const ctx = getActiveContext();
  if (ctx) {
    ctx.refCount++;
  } else {
    _refCount++;
  }
}

export function unref(): void {
  const ctx = getActiveContext();
  if (ctx) {
    if (ctx.refCount > 0) ctx.refCount--;
  } else {
    if (_refCount > 0) _refCount--;
  }
  notifyDrain();
}

export function getRefCount(): number {
  const ctx = getActiveContext();
  return ctx ? ctx.refCount : _refCount;
}

export function setRefCount(n: number): void {
  const ctx = getActiveContext();
  if (ctx) {
    ctx.refCount = n;
  } else {
    _refCount = n;
  }
}

export function resetRefCount(): void {
  const ctx = getActiveContext();
  if (ctx) {
    ctx.refCount = 0;
  } else {
    _refCount = 0;
  }
}

/* ---- Context-specific API ---- */

export function refCtx(ctx: ProcessContext): void {
  ctx.refCount++;
}

export function unrefCtx(ctx: ProcessContext): void {
  if (ctx.refCount > 0) ctx.refCount--;
  for (const cb of ctx.drainListeners) cb();
  for (const cb of _drainListeners) cb();
}

export function getRefCountCtx(ctx: ProcessContext): number {
  return ctx.refCount;
}

export function addDrainListenerCtx(ctx: ProcessContext, cb: () => void): () => void {
  ctx.drainListeners.add(cb);
  return () => ctx.drainListeners.delete(cb);
}
