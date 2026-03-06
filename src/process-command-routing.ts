import type { MemoryVolume } from "./memory-volume";

export type ProcessExecRoute =
  | {
      kind: "file";
      filePath: string;
      args: string[];
    }
  | {
      kind: "shell";
      shellCommand: string;
    };

const SHELL_SHIM_PATHS = new Set(["/bin/bash", "/bin/sh"]);
const SHELL_COMMAND_FLAG_PATTERN = /^-[A-Za-z]*c[A-Za-z]*$/;

export function routeProcessExecution(
  volume: MemoryVolume,
  command: string,
  args: string[] | undefined,
  cwd: string,
  options: {
    trimNodeEntryArg?: boolean;
  } = {},
): ProcessExecRoute {
  const normalizedArgs = args ?? [];

  if (command === "node" && normalizedArgs.length > 0) {
    return {
      kind: "file",
      filePath: resolveNodeEntryPath(normalizedArgs[0], cwd),
      args: options.trimNodeEntryArg ? normalizedArgs.slice(1) : normalizedArgs,
    };
  }

  const shellShimCommand = extractShellShimCommand(volume, command, normalizedArgs);
  if (shellShimCommand !== null) {
    return {
      kind: "shell",
      shellCommand: shellShimCommand,
    };
  }

  return {
    kind: "shell",
    shellCommand: stringifyCommand(command, normalizedArgs),
  };
}

function resolveNodeEntryPath(filePath: string, cwd: string): string {
  if (filePath.startsWith("/")) return filePath;
  return `${cwd}/${filePath}`.replace(/\/+/g, "/");
}

function extractShellShimCommand(
  volume: MemoryVolume,
  command: string,
  args: string[],
): string | null {
  if (!SHELL_SHIM_PATHS.has(command)) return null;
  if (args.length < 2) return null;
  if (!SHELL_COMMAND_FLAG_PATTERN.test(args[0] ?? "")) return null;
  if (!isExistingFile(volume, command)) return null;
  return args[1] ?? "";
}

function isExistingFile(volume: MemoryVolume, path: string): boolean {
  try {
    return volume.existsSync(path) && !volume.statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function stringifyCommand(command: string, args: string[]): string {
  return args.length > 0 ? `${command} ${args.join(" ")}` : command;
}
