import type { ShellCommand } from "../shell-types";
import type { PmDeps } from "./pm-types";
import { VERSIONS } from "../../constants/config";

const A_RESET = "\x1b[0m";
const A_BOLD = "\x1b[1m";
const A_CYAN = "\x1b[36m";

export function createPnpmCommand(deps: PmDeps): ShellCommand {
  return {
    name: "pnpm",
    async execute(params, ctx) {
      if (!deps.hasFile("/"))
        return { stdout: "", stderr: "Volume unavailable\n", exitCode: 1 };

      const sub = params[0];
      if (!sub || sub === "help" || sub === "--help") {
        return {
          stdout:
            `${A_BOLD}Usage:${A_RESET} pnpm <command>\n\n` +
            `${A_BOLD}Manage your dependencies:${A_RESET}\n` +
            `  ${A_CYAN}add${A_RESET} [pkg]         Install packages\n` +
            `  ${A_CYAN}install${A_RESET}           Install from manifest\n` +
            `  ${A_CYAN}remove${A_RESET} <pkg>      Remove a package\n` +
            `  ${A_CYAN}list${A_RESET}              List installed packages\n\n` +
            `${A_BOLD}Run your scripts:${A_RESET}\n` +
            `  ${A_CYAN}run${A_RESET} <script>      Run a script\n` +
            `  ${A_CYAN}exec${A_RESET} <cmd>        Execute a package binary\n` +
            `  ${A_CYAN}dlx${A_RESET} <pkg>         Download and execute a package\n\n` +
            `${A_BOLD}Create a project:${A_RESET}\n` +
            `  ${A_CYAN}init${A_RESET}              Create a package.json\n` +
            `  ${A_CYAN}create${A_RESET} <pkg>      Create a project\n\n` +
            `  ${A_CYAN}version${A_RESET}           Show version info\n`,
          stderr: "",
          exitCode: 0,
        };
      }

      switch (sub) {
        case "add":
          return deps.installPackages(params.slice(1), ctx, "pnpm");
        case "install":
        case "i":
          return deps.installPackages(params.slice(1), ctx, "pnpm");
        case "remove":
        case "rm":
        case "uninstall":
        case "un":
          return deps.uninstallPackages(params.slice(1), ctx, "pnpm");
        case "list":
        case "ls":
          return deps.listPackages(ctx, "pnpm");
        case "run":
          return deps.runScript(params.slice(1), ctx);
        case "start":
          return deps.runScript(["start"], ctx);
        case "test":
        case "t":
          return deps.runScript(["test"], ctx);
        case "exec":
          return deps.npxExecute(params.slice(1), ctx);
        case "dlx":
          return deps.npxExecute(params.slice(1), ctx);
        case "init":
        case "create":
          return deps.npmInitOrCreate(params.slice(1), sub, ctx);
        case "version":
        case "-v":
        case "--version":
          return { stdout: VERSIONS.PNPM + "\n", stderr: "", exitCode: 0 };
        case "audit":
          return { stdout: "No known vulnerabilities found\n", stderr: "", exitCode: 0 };
        case "outdated":
          return { stdout: "", stderr: "", exitCode: 0 };
        case "why":
          return { stdout: "", stderr: deps.formatWarn("why: not available in nodepod", "pnpm"), exitCode: 0 };
        default:
          return { stdout: "", stderr: deps.formatErr(`Unknown command "${sub}"`, "pnpm"), exitCode: 1 };
      }
    },
  };
}
