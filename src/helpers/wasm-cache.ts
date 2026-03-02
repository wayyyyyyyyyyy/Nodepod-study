// WASM compilation cache. Browsers block sync WebAssembly.Module() for large
// buffers on the main thread, so we either precompile in the background or
// offload to a worker where there's no size limit.

const PRECOMPILE_THRESHOLD = 4 * 1024 * 1024; // 4 MB

type CacheEntry = {
  promise: Promise<WebAssembly.Module>;
  module: WebAssembly.Module | null;
};

// Keyed by byte length -- good enough since multiple same-size .wasm files are rare
const sizeCache = new Map<number, CacheEntry>();

function actualByteLength(bytes: BufferSource): number {
  if (bytes instanceof ArrayBuffer) return bytes.byteLength;
  return (bytes as ArrayBufferView).byteLength;
}

function toUint8(bytes: Uint8Array | ArrayBuffer): Uint8Array {
  if (bytes instanceof ArrayBuffer) return new Uint8Array(bytes);
  if (
    bytes.byteOffset !== 0 ||
    bytes.byteLength !== (bytes.buffer as ArrayBuffer).byteLength
  ) {
    return new Uint8Array(
      bytes.buffer as ArrayBuffer,
      bytes.byteOffset,
      bytes.byteLength,
    );
  }
  return bytes;
}

function toArrayBuffer(bytes: Uint8Array | ArrayBuffer): ArrayBuffer {
  if (bytes instanceof ArrayBuffer) return bytes;
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

// Call as early as possible (e.g. when writing .wasm to VFS)
export function precompileWasm(bytes: Uint8Array | ArrayBuffer): void {
  if (typeof WebAssembly === "undefined") return;

  const len = bytes instanceof ArrayBuffer ? bytes.byteLength : bytes.byteLength;
  if (len < PRECOMPILE_THRESHOLD) return;
  if (sizeCache.has(len)) return;

  const view = toUint8(bytes);
  const entry: CacheEntry = {
    promise: WebAssembly.compile(view as BufferSource),
    module: null,
  };
  entry.promise.then(
    (m) => { entry.module = m; },
    () => {},
  );
  sizeCache.set(len, entry);
}

export function getCachedModule(bytes: BufferSource): WebAssembly.Module | null {
  const len = actualByteLength(bytes);
  const entry = sizeCache.get(len);
  if (entry?.module) return entry.module;
  return null;
}

// Worker-based compilation (no size limit in workers)
let _workerUrl: string | null = null;

function getWorkerUrl(): string {
  if (_workerUrl) return _workerUrl;
  const code = `
    self.onmessage = function(e) {
      try {
        var mod = new WebAssembly.Module(e.data.bytes);
        self.postMessage({ ok: true, module: mod });
      } catch (err) {
        self.postMessage({ ok: false, error: err.message });
      }
    };
  `;
  _workerUrl = URL.createObjectURL(
    new Blob([code], { type: "application/javascript" }),
  );
  return _workerUrl;
}

export function compileWasmInWorker(
  bytes: Uint8Array | ArrayBuffer,
): Promise<WebAssembly.Module> {
  return new Promise((resolve, reject) => {
    try {
      const worker = new Worker(getWorkerUrl());
      worker.onmessage = (e: MessageEvent) => {
        worker.terminate();
        if (e.data.ok) {
          const len = bytes instanceof ArrayBuffer ? bytes.byteLength : bytes.byteLength;
          const entry = sizeCache.get(len);
          if (entry) {
            entry.module = e.data.module;
          } else {
            sizeCache.set(len, {
              promise: Promise.resolve(e.data.module),
              module: e.data.module,
            });
          }
          resolve(e.data.module);
        } else {
          reject(new Error(e.data.error));
        }
      };
      worker.onerror = (e) => {
        worker.terminate();
        reject(new Error(e.message || "Worker compilation failed"));
      };
      const ab = toArrayBuffer(bytes);
      worker.postMessage({ bytes: ab }, [ab]);
    } catch (e) {
      // No workers -- fall back to async compile
      const view = toUint8(bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes);
      WebAssembly.compile(view as BufferSource).then(resolve, reject);
    }
  });
}

export function needsAsyncCompile(bytes: BufferSource): boolean {
  return actualByteLength(bytes) >= PRECOMPILE_THRESHOLD;
}

export { PRECOMPILE_THRESHOLD };
