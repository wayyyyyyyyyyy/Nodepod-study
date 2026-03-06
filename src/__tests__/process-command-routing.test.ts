import { describe, expect, it } from "vitest";
import { MemoryVolume } from "../memory-volume";
import { routeProcessExecution } from "../process-command-routing";

function createVolume(withShellShim = false): MemoryVolume {
  const volume = new MemoryVolume();
  if (withShellShim) {
    volume.mkdirSync("/bin", { recursive: true });
    volume.writeFileSync("/bin/bash", "shim");
    volume.writeFileSync("/bin/sh", "shim");
  }
  return volume;
}

describe("routeProcessExecution", () => {
  it("routes node commands to direct file execution", () => {
    const route = routeProcessExecution(createVolume(), "node", ["scripts/dev.js", "--watch"], "/workspace");

    expect(route).toEqual({
      kind: "file",
      filePath: "/workspace/scripts/dev.js",
      args: ["scripts/dev.js", "--watch"],
    });
  });

  it("can trim the node entry arg for child_process.spawn style execution", () => {
    const route = routeProcessExecution(
      createVolume(),
      "node",
      ["scripts/dev.js", "--watch"],
      "/workspace",
      { trimNodeEntryArg: true },
    );

    expect(route).toEqual({
      kind: "file",
      filePath: "/workspace/scripts/dev.js",
      args: ["--watch"],
    });
  });

  it("routes /bin/bash -c through the Nodepod shell shim", () => {
    const route = routeProcessExecution(
      createVolume(true),
      "/bin/bash",
      ["-c", "pwd && ls"],
      "/workspace",
    );

    expect(route).toEqual({
      kind: "shell",
      shellCommand: "pwd && ls",
    });
  });

  it("routes /bin/sh -lc through the Nodepod shell shim", () => {
    const route = routeProcessExecution(
      createVolume(true),
      "/bin/sh",
      ["-lc", "npm -v"],
      "/workspace",
    );

    expect(route).toEqual({
      kind: "shell",
      shellCommand: "npm -v",
    });
  });

  it("keeps /bin/bash as a normal command when the shim file is absent", () => {
    const route = routeProcessExecution(createVolume(false), "/bin/bash", ["-c", "pwd"], "/workspace");

    expect(route).toEqual({
      kind: "shell",
      shellCommand: "/bin/bash -c pwd",
    });
  });
});
