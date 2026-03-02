// Interactive terminal with line editing, history, raw/cooked mode, etc.
// xterm.js is a peer dep -- passed in via TerminalOptions, not imported here.

import type { TerminalOptions, TerminalTheme } from "./types";
import { DEFAULT_TERMINAL } from "../constants/config";

// GitHub Dark theme
const DEFAULT_THEME: TerminalTheme = {
  background: "#0d1117",
  foreground: "#c9d1d9",
  cursor: "#58a6ff",
  selectionBackground: "#264f78",
  black: "#0d1117",
  red: "#f85149",
  green: "#3fb950",
  yellow: "#d29922",
  blue: "#58a6ff",
  magenta: "#bc8cff",
  cyan: "#39c5cf",
  white: "#c9d1d9",
  brightBlack: "#8b949e",
  brightRed: "#f85149",
  brightGreen: "#3fb950",
  brightYellow: "#d29922",
  brightBlue: "#58a6ff",
  brightMagenta: "#bc8cff",
  brightCyan: "#39c5cf",
  brightWhite: "#ffffff",
};

const DEFAULT_PROMPT = (cwd: string) =>
  `\x1b[36mnodepod\x1b[0m:\x1b[34m${cwd}\x1b[0m$ `;

// Wired by Nodepod.createTerminal()
export interface TerminalWiring {
  onCommand: (cmd: string) => Promise<void>;
  getSendStdin: () => ((data: string) => void) | null;
  getIsStdinRaw: () => boolean;
  getActiveAbort: () => AbortController | null;
  setActiveAbort: (ac: AbortController | null) => void;
}

export class NodepodTerminal {
  private _term: any = null;
  private _fitAddon: any = null;
  private _dataDisposable: any = null;
  private _resizeHandler: (() => void) | null = null;

  private _lineBuffer = "";
  private _history: string[] = [];
  private _historyIndex = -1;
  private _savedLine = "";
  private _running = false;
  private _cwd = "/";

  private _promptFn: (cwd: string) => string;
  private _theme: TerminalTheme;
  private _opts: TerminalOptions;
  private _wiring: TerminalWiring | null = null;

  constructor(opts: TerminalOptions) {
    this._opts = opts;
    this._theme = opts.theme ?? DEFAULT_THEME;
    this._promptFn = opts.prompt ?? DEFAULT_PROMPT;
  }

  /* ---- Internal wiring ---- */

  _wireExecution(wiring: TerminalWiring): void {
    this._wiring = wiring;
  }

  _setRunning(running: boolean): void {
    this._running = running;
  }

  _writePrompt(): void {
    this._term?.write(this._promptFn(this._cwd));
  }

  _getCols(): number {
    return this._term?.cols ?? 80;
  }

  _getRows(): number {
    return this._term?.rows ?? 24;
  }

  _writeOutput(text: string, isError = false): void {
    if (!this._term) return;
    const escaped = text.replace(/\r?\n/g, "\r\n");
    if (isError) {
      this._term.write("\x1b[31m" + escaped + "\x1b[0m");
    } else {
      this._term.write(escaped);
    }
  }

  /* ---- Public API ---- */

  attach(target: HTMLElement | string): void {
    const container =
      typeof target === "string"
        ? (document.querySelector(target) as HTMLElement)
        : target;
    if (!container) throw new Error(`Terminal target not found: ${target}`);

    const TermCtor = this._opts.Terminal;

    this._term = new TermCtor({
      cursorBlink: true,
      fontSize: this._opts.fontSize ?? DEFAULT_TERMINAL.FONT_SIZE,
      fontFamily:
        this._opts.fontFamily ??
        '"Cascadia Code", "Fira Code", "Consolas", "Monaco", monospace',
      theme: this._theme,
    });

    if (this._opts.FitAddon) {
      this._fitAddon = new this._opts.FitAddon();
      this._term.loadAddon(this._fitAddon);
    }

    this._term.open(container);

    if (this._opts.WebglAddon) {
      try {
        this._term.loadAddon(new this._opts.WebglAddon());
      } catch {
        // canvas fallback is fine
      }
    }

    if (this._fitAddon) {
      // Defer fit() so the container has final layout dimensions,
      // otherwise interactive CLIs get wrong cols/rows
      const addon = this._fitAddon;
      requestAnimationFrame(() => {
        addon.fit();
        setTimeout(() => addon.fit(), 100);
      });
      this._resizeHandler = () => this._fitAddon?.fit();
      window.addEventListener("resize", this._resizeHandler);
    }

    this._dataDisposable = this._term.onData((data: string) =>
      this._handleInput(data),
    );

    this._term.focus();
  }

  detach(): void {
    if (this._dataDisposable) {
      this._dataDisposable.dispose();
      this._dataDisposable = null;
    }
    if (this._resizeHandler) {
      window.removeEventListener("resize", this._resizeHandler);
      this._resizeHandler = null;
    }
    if (this._term) {
      this._term.dispose();
      this._term = null;
    }
    this._fitAddon = null;
  }

  clear(): void {
    if (!this._term) return;
    this._term.clear();
    if (!this._running) this._term.write(this._promptFn(this._cwd));
  }

  input(text: string): void {
    if (!this._term) return;
    for (const ch of text) {
      this._handleInput(ch);
    }
  }

  setTheme(theme: Partial<TerminalTheme>): void {
    this._theme = { ...this._theme, ...theme };
    if (this._term) this._term.options.theme = this._theme;
  }

  fit(): void {
    this._fitAddon?.fit();
  }

  write(text: string): void {
    this._term?.write(text);
  }

  writeln(text: string): void {
    this._term?.writeln(text);
  }

  showPrompt(): void {
    this._term?.write(this._promptFn(this._cwd));
  }

  setCwd(cwd: string): void {
    this._cwd = cwd;
  }

  getCwd(): string {
    return this._cwd;
  }

  get xterm(): any {
    return this._term;
  }

  /* ---- Input handling ---- */

  private _handleInput(data: string): void {
    if (!this._term) return;

    if (this._running) {
      // Ctrl+C
      if (data.includes("\x03")) {
        const abort = this._wiring?.getActiveAbort();
        if (abort) {
          abort.abort();
          // Don't clear activeAbort -- nodepod.ts checks it to skip duplicate prompt
        }
        this._term.write("^C\r\n");
        this._running = false;
        this._writePrompt();
        return;
      }

      const isRaw = this._wiring?.getIsStdinRaw() ?? false;
      const sendStdin = this._wiring?.getSendStdin();

      if (isRaw && sendStdin) {
        sendStdin(data);
      } else if (sendStdin) {
        // Cooked mode: local echo + line buffering
        for (let i = 0; i < data.length; i++) {
          const ch = data[i];
          const code = ch.charCodeAt(0);
          if (ch === "\r" || ch === "\n") {
            this._term.write("\r\n");
            sendStdin("\n");
          } else if (code === 127 || code === 8) {
            this._term.write("\b \b");
            sendStdin("\x7f");
          } else if (code >= 32) {
            this._term.write(ch);
            sendStdin(ch);
          } else {
            // Control chars -- send remainder as-is
            sendStdin(data.slice(i));
            break;
          }
        }
      }
      return;
    }

    // Line editing mode
    for (let i = 0; i < data.length; i++) {
      const ch = data[i];
      const code = ch.charCodeAt(0);

      if (ch === "\r" || ch === "\n") {
        const cmd = this._lineBuffer;
        this._lineBuffer = "";
        this._historyIndex = -1;
        this._executeCommand(cmd);
      } else if (code === 127 || code === 8) {
        if (this._lineBuffer.length > 0) {
          this._lineBuffer = this._lineBuffer.slice(0, -1);
          this._term.write("\b \b");
        }
      } else if (code === 3) {
        this._lineBuffer = "";
        this._term.write("^C");
        this._writePrompt();
      } else if (code === 12) {
        this._term.clear();
        this._term.write(this._promptFn(this._cwd) + this._lineBuffer);
      } else if (ch === "\x1b" && i + 2 < data.length && data[i + 1] === "[") {
        const arrow = data[i + 2];
        i += 2;
        if (arrow === "A") this._historyUp();
        else if (arrow === "B") this._historyDown();
      } else if (code >= 32) {
        this._lineBuffer += ch;
        this._term.write(ch);
      }
    }
  }

  /* ---- History navigation ---- */

  private _historyUp(): void {
    if (this._history.length === 0) return;
    if (this._historyIndex === -1) {
      this._savedLine = this._lineBuffer;
      this._historyIndex = this._history.length - 1;
    } else if (this._historyIndex > 0) {
      this._historyIndex--;
    } else {
      return;
    }
    this._replaceLineWith(this._history[this._historyIndex]);
  }

  private _historyDown(): void {
    if (this._historyIndex === -1) return;
    if (this._historyIndex < this._history.length - 1) {
      this._historyIndex++;
      this._replaceLineWith(this._history[this._historyIndex]);
    } else {
      this._historyIndex = -1;
      this._replaceLineWith(this._savedLine);
    }
  }

  private _replaceLineWith(text: string): void {
    const prompt = this._promptFn(this._cwd);
    this._term.write(
      "\r" + prompt + " ".repeat(this._lineBuffer.length) + "\r" + prompt,
    );
    this._lineBuffer = text;
    this._term.write(text);
  }

  /* ---- Command execution ---- */

  private async _executeCommand(cmd: string): Promise<void> {
    if (!cmd.trim()) {
      this._term?.write("\r\n" + this._promptFn(this._cwd));
      return;
    }
    this._history.push(cmd);
    this._historyIndex = -1;
    this._running = true;

    if (this._wiring?.onCommand) {
      await this._wiring.onCommand(cmd);
    } else {
      this._running = false;
      this._writePrompt();
    }
  }
}
