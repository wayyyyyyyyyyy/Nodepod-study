import type { ShellCommand } from "../shell-types";
import type { PmDeps } from "./pm-types";
import { VERSIONS } from "../../constants/config";

const A_RESET = "\x1b[0m";
const A_BOLD = "\x1b[1m";
const A_DIM = "\x1b[2m";
const A_GREEN = "\x1b[32m";
const A_CYAN = "\x1b[36m";

export function createBunCommand(deps: PmDeps): ShellCommand {
  return {
    name: "bun",
    async execute(params, ctx) {
      if (!deps.hasFile("/"))
        return { stdout: "", stderr: "Volume unavailable\n", exitCode: 1 };

      const sub = params[0];
      if (!sub || sub === "help" || sub === "--help") {
        return {
          stdout:
            `${A_BOLD}Bun${A_RESET} is a fast JavaScript runtime, package manager, and bundler.\n\n` +
            `${A_DIM}Usage:${A_RESET} bun <command> [...flags] [...args]\n\n` +
            `${A_BOLD}Commands:${A_RESET}\n` +
            `  ${A_CYAN}run${A_RESET}       ${A_DIM}Run a package.json script or file${A_RESET}\n` +
            `  ${A_CYAN}install${A_RESET}   ${A_DIM}Install dependencies from package.json${A_RESET}\n` +
            `  ${A_CYAN}add${A_RESET}       ${A_DIM}Add a dependency${A_RESET}\n` +
            `  ${A_CYAN}remove${A_RESET}    ${A_DIM}Remove a dependency${A_RESET}\n` +
            `  ${A_CYAN}init${A_RESET}      ${A_DIM}Start an empty Bun project${A_RESET}\n` +
            `  ${A_CYAN}create${A_RESET}    ${A_DIM}Create a new project from a template${A_RESET}\n` +
            `  ${A_CYAN}test${A_RESET}      ${A_DIM}Run unit tests${A_RESET}\n` +
            `  ${A_CYAN}x${A_RESET}         ${A_DIM}Execute a package binary (bunx)${A_RESET}\n` +
            `  ${A_CYAN}pm${A_RESET}        ${A_DIM}Package manager utilities${A_RESET}\n`,
          stderr: "",
          exitCode: 0,
        };
      }

      switch (sub) {
        case "run":
          if (
            params[1] &&
            (params[1].endsWith(".js") ||
              params[1].endsWith(".ts") ||
              params[1].endsWith(".mjs") ||
              params[1].endsWith(".tsx") ||
              params[1].endsWith(".jsx"))
          ) {
            return deps.executeNodeBinary(params[1], params.slice(2), ctx);
          }
          return deps.runScript(params.slice(1), ctx);
        case "start":
          return deps.runScript(["start"], ctx);
        case "test":
        case "t":
          return deps.runScript(["test"], ctx);
        case "install":
        case "i":
          return deps.installPackages(params.slice(1), ctx, "bun");
        case "add":
          return deps.installPackages(params.slice(1), ctx, "bun");
        case "remove":
        case "rm":
          return deps.uninstallPackages(params.slice(1), ctx, "bun");
        case "x":
          return deps.npxExecute(params.slice(1), ctx);
        case "init":
        case "create":
          return deps.npmInitOrCreate(params.slice(1), sub, ctx);
        case "pm": {
          const pmSub = params[1];
          if (pmSub === "ls" || pmSub === "list")
            return deps.listPackages(ctx, "bun");
          if (pmSub === "cache")
            return { stdout: "Cache path: /tmp/bun-cache\n", stderr: "", exitCode: 0 };
          return {
            stdout: `${A_DIM}bun pm: available subcommands: ls, cache${A_RESET}\n`,
            stderr: "",
            exitCode: 0,
          };
        }
        case "version":
        case "-v":
        case "--version":
          return { stdout: VERSIONS.BUN + "\n", stderr: "", exitCode: 0 };
        case "upgrade":
          return {
            stdout: `${A_GREEN}Bun is already up to date.${A_RESET}\n`,
            stderr: "",
            exitCode: 0,
          };
        default: {
          // bare `bun <file>` runs it directly, otherwise treat as script
          if (params[0] && !params[0].startsWith("-")) {
            const filePath = params[0].startsWith("/")
              ? params[0]
              : `${ctx.cwd}/${params[0]}`.replace(/\/+/g, "/");
            if (deps.hasFile(filePath)) {
              return deps.executeNodeBinary(params[0], params.slice(1), ctx);
            }
            return deps.runScript(params, ctx);
          }
          return {
            stdout: "",
            stderr: `error: unknown command "${sub}"\n`,
            exitCode: 1,
          };
        }
      }
    },
  };
}

export function createBunxCommand(deps: PmDeps): ShellCommand {
  return {
    name: "bunx",
    async execute(params, ctx) {
      return deps.npxExecute(params, ctx);
    },
  };
}
