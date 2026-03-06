import { describe, expect, it, vi } from "vitest";
import { EventEmitter } from "../polyfills/events";
import { Nodepod } from "../sdk/nodepod";
import type { TerminalOptions } from "../sdk/types";

vi.mock("virtual:process-worker-bundle", () => ({
  PROCESS_WORKER_BUNDLE: "",
}));

class FakeXTerm {}

class FakeHandle extends EventEmitter {
  state: "running" | "exited" = "running";
  pid: number;
  execCalls: any[] = [];

  constructor(pid: number) {
    super();
    this.pid = pid;
  }

  exec(msg: any): void {
    this.execCalls.push(msg);
  }

  sendStdin(_data: string): void {
    // No-op for cwd regression tests.
  }
}

function createFakeNodepod(cwd = "/home/user/.pi/agent") {
  const handles: FakeHandle[] = [];
  let nextPid = 1000;

  const nodepod = Object.create(Nodepod.prototype) as Nodepod;
  (nodepod as any)._cwd = cwd;
  (nodepod as any)._baseEnv = { HOME: "/home/user", PATH: "/usr/bin" };
  (nodepod as any)._processManager = {
    spawn: () => {
      const handle = new FakeHandle(nextPid++);
      handles.push(handle);
      return handle;
    },
    kill: () => {
      // No-op for cwd regression tests.
    },
  };

  return { nodepod, handles };
}

function createTerminal(nodepod: Nodepod, opts: Partial<TerminalOptions> = {}) {
  return nodepod.createTerminal({
    Terminal: FakeXTerm,
    ...opts,
  } as TerminalOptions);
}

function getWiring(terminal: any) {
  return terminal._wiring as {
    onCommand: (cmd: string) => Promise<void>;
  };
}

async function flushCommandSetup(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("Nodepod.createTerminal cwd isolation", () => {
  it("keeps the default shared runtime cwd behavior for compatibility", async () => {
    const { nodepod, handles } = createFakeNodepod();
    const terminalA = createTerminal(nodepod);
    const terminalB = createTerminal(nodepod);

    const runA = getWiring(terminalA).onCommand("cd /workspace/vite-check");
    await flushCommandSetup();
    handles[0].emit("cwd-change", "/workspace/vite-check");
    handles[0].emit("shell-done", 0, "", "");
    await runA;

    expect((nodepod as any)._cwd).toBe("/workspace/vite-check");

    const runB = getWiring(terminalB).onCommand("pwd");
    await flushCommandSetup();
    expect(handles[1].execCalls[0].cwd).toBe("/workspace/vite-check");
    handles[1].emit("shell-done", 0, "/workspace/vite-check\n", "");
    await runB;
  });

  it("isolates cwd per terminal when shareRuntimeCwd is disabled", async () => {
    const { nodepod, handles } = createFakeNodepod();
    const initialCwd = (nodepod as any)._cwd;
    const terminalA = createTerminal(nodepod, { shareRuntimeCwd: false });
    const terminalB = createTerminal(nodepod, { shareRuntimeCwd: false });

    const runA = getWiring(terminalA).onCommand("cd /workspace/vite-check");
    await flushCommandSetup();
    handles[0].emit("cwd-change", "/workspace/vite-check");
    handles[0].emit("shell-done", 0, "", "");
    await runA;

    expect((nodepod as any)._cwd).toBe(initialCwd);
    expect(terminalA.getCwd()).toBe("/workspace/vite-check");
    expect(terminalB.getCwd()).toBe(initialCwd);

    const runB = getWiring(terminalB).onCommand("pwd");
    await flushCommandSetup();
    expect(handles[1].execCalls[0].cwd).toBe(initialCwd);
    handles[1].emit("shell-done", 0, `${initialCwd}\n`, "");
    await runB;
  });
});
