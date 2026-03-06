function buildShellShimScript(shellPath: string): string {
  return [
    "#!/usr/bin/env node",
    `'use strict';`,
    "",
    "const { exec } = require('child_process');",
    "",
    "const args = process.argv.slice(2);",
    "const mode = args[0] || '';",
    "const command = args[1] || '';",
    "const supportsCommand = /^-[A-Za-z]*c[A-Za-z]*$/.test(mode);",
    "",
    "if (!supportsCommand) {",
    `  process.stderr.write('${shellPath}: only -c style invocations are supported in Nodepod\\\\n');`,
    "  process.exit(2);",
    "}",
    "",
    "exec(command, { cwd: process.cwd(), env: process.env }, (error, stdout, stderr) => {",
    "  if (stdout) process.stdout.write(stdout);",
    "  if (stderr) process.stderr.write(stderr);",
    "  process.exit(error && typeof error.code === 'number' ? error.code : 0);",
    "});",
    "",
  ].join("\n");
}

export const NODEPOD_SHELL_COMPAT_FILES: Record<string, string> = {
  "/bin/bash": buildShellShimScript("/bin/bash"),
  "/bin/sh": buildShellShimScript("/bin/sh"),
};
