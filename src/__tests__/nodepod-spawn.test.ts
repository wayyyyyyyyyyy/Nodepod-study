import { describe, expect, it, vi } from "vitest";
import { EventEmitter } from "../polyfills/events";
import { Nodepod } from "../sdk/nodepod";
import { MemoryVolume } from "../memory-volume";

vi.mock("virtual:process-worker-bundle", () => ({
  PROCESS_WORKER_BUNDLE: "",
}));

class FakeHandle extends EventEmitter {
  state: "running" | "exited" = "running";
  execCalls: any[] = [];

  exec(msg: any): void {
    this.execCalls.push(msg);
  }

  sendStdin(_data: string): void {
    // No-op for spawn routing tests.
  }

  kill(_signal: string): void {
    // No-op for spawn routing tests.
  }
}

function createFakeNodepod(withShellShim = false) {
  const handle = new FakeHandle();
  const volume = new MemoryVolume();
  if (withShellShim) {
    volume.mkdirSync("/bin", { recursive: true });
    volume.writeFileSync("/bin/bash", "shim");
  }

  const nodepod = Object.create(Nodepod.prototype) as Nodepod;
  (nodepod as any)._cwd = "/workspace";
  (nodepod as any)._baseEnv = { HOME: "/home/user", PATH: "/usr/bin:/bin" };
  (nodepod as any)._volume = volume;
  (nodepod as any)._processManager = {
    spawn: () => handle,
  };

  return { nodepod, handle };
}

describe("Nodepod.spawn", () => {
  it("routes /bin/bash -c through shell execution when the shim file exists", async () => {
    const { nodepod, handle } = createFakeNodepod(true);

    await nodepod.spawn("/bin/bash", ["-c", "pwd && ls"]);

    expect(handle.execCalls[0]).toMatchObject({
      isShell: true,
      shellCommand: "pwd && ls",
      cwd: "/workspace",
    });
  });

  it("keeps node commands on the direct file execution path", async () => {
    const { nodepod, handle } = createFakeNodepod(false);

    await nodepod.spawn("node", ["scripts/dev.js", "--watch"]);

    expect(handle.execCalls[0]).toMatchObject({
      isShell: false,
      filePath: "/workspace/scripts/dev.js",
      args: ["scripts/dev.js", "--watch"],
    });
  });
});
