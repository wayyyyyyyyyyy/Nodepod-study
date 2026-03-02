// readline polyfill -- createInterface, emitKeypressEvents, terminal helpers.
// tracks line/cursor on every keystroke because @clack reads rl.line directly.

import { EventEmitter } from "./events";
import { ref as _elRef, unref as _elUnref } from "../helpers/event-loop";

// child_process wait loop checks this to avoid exiting while waiting for user input
let _activeInterfaceCount = 0;

export function getActiveInterfaceCount(): number {
  return _activeInterfaceCount;
}

export function setActiveInterfaceCount(n: number): void {
  _activeInterfaceCount = n;
}

export function resetActiveInterfaceCount(): void {
  _activeInterfaceCount = 0;
}


export interface InterfaceConfig {
  input?: unknown;
  output?: unknown;
  terminal?: boolean;
  prompt?: string;
  historySize?: number;
  completer?: (line: string) => [string[], string] | void;
  crlfDelay?: number;
  escapeCodeTimeout?: number;
  tabSize?: number;
}

// emitKeypressEvents: parse data events into keypress events

const KEYPRESS_DECODER = Symbol("keypressDecoder");

// mirrors Node.js internal emitKeys generator
function parseAndEmitKeypress(
  stream: any,
  char: string,
  escapeBuf: string[],
): string[] {
  if (escapeBuf.length > 0) {
    escapeBuf.push(char);
    const seq = escapeBuf.join("");

    if (seq.length >= 3 && seq[1] === "[") {
      // CSI sequence
      const lastChar = seq[seq.length - 1];
      if (/[A-Za-z~]/.test(lastChar)) {
          let name = "";
        if (lastChar === "A") name = "up";
        else if (lastChar === "B") name = "down";
        else if (lastChar === "C") name = "right";
        else if (lastChar === "D") name = "left";
        else if (lastChar === "H") name = "home";
        else if (lastChar === "F") name = "end";
        else if (seq === "\x1b[3~") name = "delete";
        else if (seq === "\x1b[2~") name = "insert";
        else if (seq === "\x1b[5~") name = "pageup";
        else if (seq === "\x1b[6~") name = "pagedown";
        else name = lastChar;

        stream.emit("keypress", seq, {
          sequence: seq,
          name,
          ctrl: false,
          meta: false,
          shift: false,
        });
        return [];
      }
      if (seq.length > 8) {
        stream.emit("keypress", seq, {
          sequence: seq,
          name: "unknown",
          ctrl: false,
          meta: false,
          shift: false,
        });
        return [];
      }
      return escapeBuf;
    }

    if (seq.length >= 3 && seq[1] === "O") {
      const lastChar = seq[seq.length - 1];
      let name = "";
      if (lastChar === "A") name = "up";
      else if (lastChar === "B") name = "down";
      else if (lastChar === "C") name = "right";
      else if (lastChar === "D") name = "left";
      else if (lastChar === "H") name = "home";
      else if (lastChar === "F") name = "end";
      else name = lastChar;

      stream.emit("keypress", seq, {
        sequence: seq,
        name,
        ctrl: false,
        meta: false,
        shift: false,
      });
      return [];
    }

    if (seq.length >= 2 && seq[1] !== "[" && seq[1] !== "O") {
      stream.emit("keypress", seq, {
        sequence: seq,
        name: "escape",
        ctrl: false,
        meta: true,
        shift: false,
      });
      return [];
    }

    return escapeBuf;
  }

  if (char === "\x1b") {
    return [char];
  }

  let name = char;
  let ctrl = false;
  if (char === "\r" || char === "\n") name = "return";
  else if (char === "\x7f" || char === "\b") name = "backspace";
  else if (char === "\t") name = "tab";
  else if (char === " ") name = "space";
  else if (char.charCodeAt(0) < 32) {
    // Ctrl+letter
    ctrl = true;
    name = String.fromCharCode(char.charCodeAt(0) + 96);
  }

  stream.emit("keypress", char, {
    sequence: char,
    name,
    ctrl,
    meta: false,
    shift: false,
  });

  return [];
}

export function emitKeypressEvents(stream: unknown, _iface?: Interface): void {
  if (!stream || typeof (stream as any).on !== "function") return;
  if ((stream as any)[KEYPRESS_DECODER]) return;
  (stream as any)[KEYPRESS_DECODER] = true;

  let escapeBuf: string[] = [];
  let escapeTimeout: ReturnType<typeof setTimeout> | null = null;

  (stream as any).on("data", (data: unknown) => {
    if ((stream as any).listenerCount("keypress") <= 0) return;
    const text = typeof data === "string" ? data : String(data);

    for (const char of text) {
      if (escapeTimeout) {
        clearTimeout(escapeTimeout);
        escapeTimeout = null;
      }
      escapeBuf = parseAndEmitKeypress(stream as any, char, escapeBuf);

      // flush pending escape after timeout
      if (escapeBuf.length > 0) {
        escapeTimeout = setTimeout(() => {
          if (escapeBuf.length > 0) {
            const seq = escapeBuf.join("");
            (stream as any).emit("keypress", seq, {
              sequence: seq,
              name: "escape",
              ctrl: false,
              meta: false,
              shift: false,
            });
            escapeBuf = [];
          }
        }, 50);
      }
    }
  });
}


export interface Interface extends EventEmitter {
  _promptStr: string;
  _input: unknown;
  _output: unknown;
  _closed: boolean;
  _lineBuffer: string;
  _pendingQuestions: Array<{
    query: string;
    handler: (answer: string) => void;
  }>;
  terminal: boolean;
  line: string;
  cursor: number;
  _refreshLine(): void;
  _onKeypress(char: string | undefined, key: any): void;
  _onData(text: string): void;
  prompt(preserveCursor?: boolean): void;
  setPrompt(text: string): void;
  getPrompt(): string;
  question(query: string, optsOrHandler?: unknown, handler?: (answer: string) => void): void;
  pause(): this;
  resume(): this;
  close(): void;
  write(data: string | null, _key?: { ctrl?: boolean; name?: string; meta?: boolean; shift?: boolean; sequence?: string }): void;
  getCursorPos(): { rows: number; cols: number };
  [Symbol.asyncIterator](): AsyncGenerator<string, void, undefined>;
}

interface InterfaceConstructor {
  new (cfg?: InterfaceConfig): Interface;
  (this: any, cfg?: InterfaceConfig): void;
  prototype: any;
}

export const Interface = function Interface(this: any, cfg?: InterfaceConfig) {
  if (!this) return;
  EventEmitter.call(this);
  this._promptStr = cfg?.prompt ?? "> ";
  this._input = cfg?.input;
  this._output = cfg?.output;
  this._closed = false;
  this._lineBuffer = "";
  this._pendingQuestions = [];
  this.terminal = cfg?.terminal ?? false;
  this.line = "";
  this.cursor = 0;

  if (this._input && typeof (this._input as any).on === "function") {
    _activeInterfaceCount++;
    _elRef();
    const inputStream = this._input as EventEmitter;
    const self = this;

    if (this.terminal) {
      emitKeypressEvents(this._input, this);

      inputStream.on("keypress", (char: string | undefined, key: any) => {
        if (self._closed) return;
        self._onKeypress(char, key);
      });
    } else {
      inputStream.on("data", (data: unknown) => {
        if (self._closed) return;
        const text = typeof data === "string" ? data : String(data);
        self._onData(text);
      });
    }

    inputStream.on("end", () => {
      if (!self._closed) self.close();
    });
  }
} as unknown as InterfaceConstructor;

Object.setPrototypeOf(Interface.prototype, EventEmitter.prototype);

Interface.prototype._refreshLine = function _refreshLine(this: any): void {
  if (this._output && typeof (this._output as any).write === "function") {
    (this._output as any).write(this.line);
  }
};

Interface.prototype._onKeypress = function _onKeypress(this: any, char: string | undefined, key: any): void {
  if (!key) return;

  if (key.ctrl && key.name === "c") {
    this.close();
    return;
  }

  if (key.name === "return") {
    const line = this._lineBuffer;
    this._lineBuffer = "";
    this.line = line;

    if (this._pendingQuestions.length > 0) {
      const q = this._pendingQuestions.shift()!;
      q.handler(line);
    }

    this.emit("line", line);
    this.line = "";
    this.cursor = 0;
    return;
  }

  if (key.name === "backspace") {
    if (this.cursor > 0) {
      this._lineBuffer =
        this._lineBuffer.slice(0, this.cursor - 1) +
        this._lineBuffer.slice(this.cursor);
      this.cursor--;
      this.line = this._lineBuffer;
      this._refreshLine();
    }
    return;
  }

  if (key.name === "delete") {
    if (this.cursor < this._lineBuffer.length) {
      this._lineBuffer =
        this._lineBuffer.slice(0, this.cursor) +
        this._lineBuffer.slice(this.cursor + 1);
      this.line = this._lineBuffer;
      this._refreshLine();
    }
    return;
  }

  if (key.name === "left") {
    this.cursor = Math.max(0, this.cursor - 1);
    this._refreshLine();
    return;
  }
  if (key.name === "right") {
    this.cursor = Math.min(this._lineBuffer.length, this.cursor + 1);
    this._refreshLine();
    return;
  }
  if (key.name === "home") {
    this.cursor = 0;
    this._refreshLine();
    return;
  }
  if (key.name === "end") {
    this.cursor = this._lineBuffer.length;
    this._refreshLine();
    return;
  }

  if (key.ctrl && key.name === "u") {
    this._lineBuffer = this._lineBuffer.slice(this.cursor);
    this.cursor = 0;
    this.line = this._lineBuffer;
    this._refreshLine();
    return;
  }

  if (key.ctrl && key.name === "k") {
    this._lineBuffer = this._lineBuffer.slice(0, this.cursor);
    this.line = this._lineBuffer;
    this._refreshLine();
    return;
  }

  if (key.ctrl && key.name === "h") {
    if (this.cursor > 0) {
      this._lineBuffer =
        this._lineBuffer.slice(0, this.cursor - 1) +
        this._lineBuffer.slice(this.cursor);
      this.cursor--;
      this.line = this._lineBuffer;
      this._refreshLine();
    }
    return;
  }

  if (
    char &&
    !key.ctrl &&
    !key.meta &&
    char.length === 1 &&
    char.charCodeAt(0) >= 32
  ) {
    this._lineBuffer =
      this._lineBuffer.slice(0, this.cursor) +
      char +
      this._lineBuffer.slice(this.cursor);
    this.cursor++;
    this.line = this._lineBuffer;
    this._refreshLine();
    return;
  }

};

Interface.prototype._onData = function _onData(this: any, text: string): void {
  for (const char of text) {
    if (char === "\n" || char === "\r") {
      const line = this._lineBuffer;
      this._lineBuffer = "";
      this.line = line;

      if (this._pendingQuestions.length > 0) {
        const q = this._pendingQuestions.shift()!;
        q.handler(line);
      }

      this.emit("line", line);
      this.line = "";
      this.cursor = 0;
    } else if (char === "\x7f" || char === "\b") {
      if (this._lineBuffer.length > 0) {
        this._lineBuffer =
          this._lineBuffer.slice(0, this.cursor - 1) +
          this._lineBuffer.slice(this.cursor);
        this.cursor = Math.max(0, this.cursor - 1);
        this.line = this._lineBuffer;
        this._refreshLine();
      }
    } else if (char.charCodeAt(0) >= 32) {
      this._lineBuffer =
        this._lineBuffer.slice(0, this.cursor) +
        char +
        this._lineBuffer.slice(this.cursor);
      this.cursor++;
      this.line = this._lineBuffer;
      this._refreshLine();
    }
  }
};

Interface.prototype.prompt = function prompt(this: any, preserveCursor?: boolean): void {
  if (this._output && typeof (this._output as any).write === "function") {
    (this._output as any).write(this._promptStr);
  }
  if (!preserveCursor) {
    this.cursor = 0;
    this.line = "";
    this._lineBuffer = "";
  }
};

Interface.prototype.setPrompt = function setPrompt(this: any, text: string): void {
  this._promptStr = text;
};

Interface.prototype.getPrompt = function getPrompt(this: any): string {
  return this._promptStr;
};

Interface.prototype.question = function question(
  this: any,
  query: string,
  optsOrHandler?: unknown,
  handler?: (answer: string) => void,
): void {
  const actualHandler =
    typeof optsOrHandler === "function"
      ? (optsOrHandler as (answer: string) => void)
      : handler;
  if (!actualHandler) return;

  if (this._output && typeof (this._output as any).write === "function") {
    (this._output as any).write(query);
  }

  if (this._input && typeof (this._input as any).on === "function") {
    this._pendingQuestions.push({ query, handler: actualHandler });
  } else {
    setTimeout(() => actualHandler(""), 0);
  }
};

Interface.prototype.pause = function pause(this: any): any {
  if (this._input && typeof (this._input as any).pause === "function") {
    (this._input as any).pause();
  }
  this.emit("pause");
  return this;
};

Interface.prototype.resume = function resume(this: any): any {
  if (this._input && typeof (this._input as any).resume === "function") {
    (this._input as any).resume();
  }
  this.emit("resume");
  return this;
};

Interface.prototype.close = function close(this: any): void {
  if (this._closed) return;
  this._closed = true;
  if (this._input && typeof (this._input as any).on === "function") {
    _activeInterfaceCount = Math.max(0, _activeInterfaceCount - 1);
    _elUnref();
  }
  for (const q of this._pendingQuestions) {
    q.handler("");
  }
  this._pendingQuestions.length = 0;
  this.emit("close");
};

Interface.prototype.write = function write(
  this: any,
  data: string | null,
  _key?: {
    ctrl?: boolean;
    name?: string;
    meta?: boolean;
    shift?: boolean;
    sequence?: string;
  },
): void {
  if (this._closed) return;

  if (data === null || data === undefined) {
    if (_key) {
      // emit synthetic keypress on input so external listeners (e.g. @clack) see it
      const emitOnInput =
        this._input && typeof (this._input as any).emit === "function";

      if (_key.ctrl && _key.name === "c") {
        this.close();
        return;
      }
      if (_key.ctrl && _key.name === "h") {
        // Backspace
        if (this.cursor > 0) {
          this._lineBuffer =
            this._lineBuffer.slice(0, this.cursor - 1) +
            this._lineBuffer.slice(this.cursor);
          this.cursor--;
          this.line = this._lineBuffer;
        }
        if (emitOnInput) {
          (this._input as any).emit("keypress", "\x7f", {
            sequence: "\x7f",
            name: "backspace",
            ctrl: false,
            meta: false,
            shift: false,
          });
        }
        return;
      }
      if (_key.ctrl && _key.name === "u") {
        this._lineBuffer = this._lineBuffer.slice(this.cursor);
        this.cursor = 0;
        this.line = this._lineBuffer;
        return;
      }
      if (_key.ctrl && _key.name === "k") {
        this._lineBuffer = this._lineBuffer.slice(0, this.cursor);
        this.line = this._lineBuffer;
        return;
      }
      if (_key.name === "left") {
        this.cursor = Math.max(0, this.cursor - 1);
        return;
      }
      if (_key.name === "right") {
        this.cursor = Math.min(this._lineBuffer.length, this.cursor + 1);
        return;
      }
      if (_key.name === "home") {
        this.cursor = 0;
        return;
      }
      if (_key.name === "end") {
        this.cursor = this._lineBuffer.length;
        return;
      }
    }
    return;
  }

  if (_key?.ctrl && _key?.name === "c") {
    this.close();
    return;
  }

  this._onData(data);
};

Interface.prototype.getCursorPos = function getCursorPos(this: any): { rows: number; cols: number } {
  return { rows: 0, cols: this.cursor };
};

Interface.prototype[Symbol.asyncIterator] = async function*(this: any): AsyncGenerator<string, void, undefined> {
  const self = this;
  while (!self._closed) {
    const line = await new Promise<string | null>((resolve) => {
      if (self._closed) {
        resolve(null);
        return;
      }
      self.once("line", (l: string) => resolve(l));
      self.once("close", () => resolve(null));
    });
    if (line === null) break;
    yield line;
  }
};


export function createInterface(
  cfgOrInput?: InterfaceConfig | unknown,
  output?: unknown,
): Interface {
  if (
    cfgOrInput &&
    typeof cfgOrInput === "object" &&
    !("on" in (cfgOrInput as any)) &&
    !("read" in (cfgOrInput as any))
  ) {
    return new Interface(cfgOrInput as InterfaceConfig);
  }
  return new Interface({ input: cfgOrInput, output });
}


export function clearLine(
  stream: unknown,
  dir: number,
  done?: () => void,
): boolean {
  if (stream && typeof (stream as any).clearLine === "function") {
    return (stream as any).clearLine(dir, done);
  }
  if (done) done();
  return true;
}

export function clearScreenDown(stream: unknown, done?: () => void): boolean {
  if (stream && typeof (stream as any).write === "function") {
    (stream as any).write("\x1b[J");
  }
  if (done) done();
  return true;
}

export function cursorTo(
  stream: unknown,
  x: number,
  yOrDone?: number | (() => void),
  done?: () => void,
): boolean {
  const cb = typeof yOrDone === "function" ? yOrDone : done;
  if (stream && typeof (stream as any).cursorTo === "function") {
    return (stream as any).cursorTo(
      x,
      typeof yOrDone === "number" ? yOrDone : undefined,
      cb,
    );
  }
  if (cb) cb();
  return true;
}

export function moveCursor(
  stream: unknown,
  dx: number,
  dy: number,
  done?: () => void,
): boolean {
  if (stream && typeof (stream as any).moveCursor === "function") {
    return (stream as any).moveCursor(dx, dy, done);
  }
  if (done) done();
  return true;
}


export const promises = {
  createInterface(cfg?: InterfaceConfig) {
    const rl = createInterface(cfg);
    return {
      question(query: string): Promise<string> {
        return new Promise((resolve) => rl.question(query, resolve));
      },
      close(): void {
        rl.close();
      },
      async *[Symbol.asyncIterator](): AsyncGenerator<string, void, undefined> {
        yield* rl;
      },
    };
  },
};


export default {
  Interface,
  createInterface,
  clearLine,
  clearScreenDown,
  cursorTo,
  moveCursor,
  emitKeypressEvents,
  promises,
};
