import { describe, expect, it } from "vitest";
import { NODEPOD_SHELL_COMPAT_FILES } from "../live-node-agent/nodepod-shell-shims";

describe("NODEPOD_SHELL_COMPAT_FILES", () => {
  it("injects both /bin/bash and /bin/sh", () => {
    expect(Object.keys(NODEPOD_SHELL_COMPAT_FILES).sort()).toEqual(["/bin/bash", "/bin/sh"]);
  });

  it("provides a -c fallback shim script", () => {
    expect(NODEPOD_SHELL_COMPAT_FILES["/bin/bash"]).toContain("only -c style invocations are supported");
    expect(NODEPOD_SHELL_COMPAT_FILES["/bin/bash"]).toContain("exec(command");
  });
});
