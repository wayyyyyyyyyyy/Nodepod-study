// SyncChannel — true blocking execSync/spawnSync via SharedArrayBuffer + Atomics.
// Worker allocates a slot, posts spawn-sync, blocks on Atomics.wait().
// Main thread runs the child, writes result to the slot, calls Atomics.notify().

import { isSharedArrayBufferAvailable } from "./shared-vfs";

// --- Shared memory layout ---
//
// Per-slot (16KB = 4096 Int32s):
//   [0] status (0=pending, 1=complete, 2=error)
//   [1] exit code
//   [2] stdout byte length
//   [3..4095] stdout data
//
// Last Int32 at MAX_SLOTS * SLOT_SIZE is the atomic allocation counter.
export const SLOT_SIZE = 4096; // 4096 Int32 values = 16KB per slot
export const MAX_SLOTS = 64;
const STATUS_PENDING = 0;
const STATUS_COMPLETE = 1;
const STATUS_ERROR = 2;

const DEFAULT_SYNC_BUFFER_SIZE = MAX_SLOTS * SLOT_SIZE * 4 + 4; // ~1MB
const COUNTER_INDEX = MAX_SLOTS * SLOT_SIZE;

// --- SyncChannelController (main thread) ---
export class SyncChannelController {
  private _buffer: SharedArrayBuffer;
  private _int32: Int32Array;
  private _uint8: Uint8Array;

  constructor(bufferSize: number = DEFAULT_SYNC_BUFFER_SIZE) {
    if (!isSharedArrayBufferAvailable()) {
      throw new Error("SharedArrayBuffer not available. Ensure COOP/COEP headers are set.");
    }

    this._buffer = new SharedArrayBuffer(bufferSize);
    this._int32 = new Int32Array(this._buffer);
    this._uint8 = new Uint8Array(this._buffer);

    for (let i = 0; i < MAX_SLOTS; i++) {
      Atomics.store(this._int32, i * SLOT_SIZE, STATUS_PENDING);
    }
    Atomics.store(this._int32, COUNTER_INDEX, 0);
  }

  get buffer(): SharedArrayBuffer {
    return this._buffer;
  }

  writeResult(syncSlot: number, exitCode: number, stdout: string): void {
    const base = syncSlot * SLOT_SIZE;

    Atomics.store(this._int32, base + 1, exitCode);

    const encoder = new TextEncoder();
    const stdoutBytes = encoder.encode(stdout);
    const maxStdoutLen = (SLOT_SIZE - 3) * 4;
    const truncatedLen = Math.min(stdoutBytes.byteLength, maxStdoutLen);

    Atomics.store(this._int32, base + 2, truncatedLen);

    const dataOffset = (base + 3) * 4;
    this._uint8.set(stdoutBytes.subarray(0, truncatedLen), dataOffset);

    // Must be last — wakes the waiting worker
    Atomics.store(this._int32, base, STATUS_COMPLETE);
    Atomics.notify(this._int32, base);
  }

  writeError(syncSlot: number, exitCode: number, errorMessage: string): void {
    const base = syncSlot * SLOT_SIZE;

    Atomics.store(this._int32, base + 1, exitCode);

    const encoder = new TextEncoder();
    const errorBytes = encoder.encode(errorMessage);
    const maxLen = (SLOT_SIZE - 3) * 4;
    const truncatedLen = Math.min(errorBytes.byteLength, maxLen);

    Atomics.store(this._int32, base + 2, truncatedLen);
    const dataOffset = (base + 3) * 4;
    this._uint8.set(errorBytes.subarray(0, truncatedLen), dataOffset);

    Atomics.store(this._int32, base, STATUS_ERROR);
    Atomics.notify(this._int32, base);
  }
}

// --- SyncChannelWorker (worker thread) ---
export class SyncChannelWorker {
  private _int32: Int32Array;
  private _uint8: Uint8Array;

  constructor(buffer: SharedArrayBuffer) {
    this._int32 = new Int32Array(buffer);
    this._uint8 = new Uint8Array(buffer);
  }

  // Atomic counter prevents slot collisions across workers
  allocateSlot(): number {
    const raw = Atomics.add(this._int32, COUNTER_INDEX, 1);
    const slot = raw % MAX_SLOTS;
    Atomics.store(this._int32, slot * SLOT_SIZE, STATUS_PENDING);
    return slot;
  }

  // Blocks the worker thread until main writes the result
  waitForResult(syncSlot: number, timeoutMs: number = 120_000): { exitCode: number; stdout: string } {
    const base = syncSlot * SLOT_SIZE;

    const result = Atomics.wait(this._int32, base, STATUS_PENDING, timeoutMs);

    if (result === "timed-out") {
      throw new Error("execSync timed out");
    }

    const status = Atomics.load(this._int32, base);
    const exitCode = Atomics.load(this._int32, base + 1);
    const stdoutLen = Atomics.load(this._int32, base + 2);

    const decoder = new TextDecoder();
    const dataOffset = (base + 3) * 4;
    const stdoutBytes = this._uint8.slice(dataOffset, dataOffset + stdoutLen);
    const stdout = decoder.decode(stdoutBytes);

    if (status === STATUS_ERROR) {
      const err = new Error(`Command failed with exit code ${exitCode}\n${stdout}`);
      (err as any).status = exitCode;
      (err as any).stdout = stdout;
      throw err;
    }

    return { exitCode, stdout };
  }
}
