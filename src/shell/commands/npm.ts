import type { ShellCommand } from "../shell-types";
import type { PmDeps } from "./pm-types";
import { VERSIONS, NPM_REGISTRY_URL_SLASH } from "../../constants/config";

const A_RESET = "\x1b[0m";
const A_BOLD = "\x1b[1m";
const A_CYAN = "\x1b[36m";

export function createNpmCommand(deps: PmDeps): ShellCommand {
  return {
    name: "npm",
    async execute(params, ctx) {
      if (!deps.hasFile("/"))
        return { stdout: "", stderr: "Volume unavailable\n", exitCode: 1 };

      const sub = params[0];
      if (!sub || sub === "help" || sub === "--help") {
        return {
          stdout:
            `${A_BOLD}Usage:${A_RESET} npm <command>\n\n` +
            `${A_BOLD}Commands:${A_RESET}\n` +
            `  ${A_CYAN}run${A_RESET} <script>      Run a package.json script\n` +
            `  ${A_CYAN}start${A_RESET}             Alias for npm run start\n` +
            `  ${A_CYAN}test${A_RESET}              Alias for npm run test\n` +
            `  ${A_CYAN}install${A_RESET} [pkg]     Install packages\n` +
            `  ${A_CYAN}uninstall${A_RESET} <pkg>   Remove a package\n` +
            `  ${A_CYAN}ls${A_RESET}                List installed packages\n` +
            `  ${A_CYAN}init${A_RESET}              Create a package.json\n` +
            `  ${A_CYAN}create${A_RESET} <pkg>      Create a project (runs create-<pkg>)\n` +
            `  ${A_CYAN}version${A_RESET}           Show version info\n` +
            `  ${A_CYAN}info${A_RESET} <pkg>        Show package info\n` +
            `  ${A_CYAN}exec${A_RESET} <cmd>        Execute a package binary\n` +
            `  ${A_CYAN}prefix${A_RESET}            Show prefix\n` +
            `  ${A_CYAN}root${A_RESET}              Show node_modules path\n` +
            `  ${A_CYAN}bin${A_RESET}               Show bin directory\n` +
            `  ${A_CYAN}config${A_RESET}            Manage configuration\n`,
          stderr: "",
          exitCode: 0,
        };
      }

      switch (sub) {
        case "run":
        case "run-script":
          return deps.runScript(params.slice(1), ctx);
        case "start":
          return deps.runScript(["start"], ctx);
        case "test":
        case "t":
        case "tst":
          return deps.runScript(["test"], ctx);
        case "install":
        case "i":
        case "add":
          return deps.installPackages(params.slice(1), ctx);
        case "ci":
          try {
            deps.removeNodeModules(ctx.cwd);
          } catch {
            /* */
          }
          return deps.installPackages([], ctx);
        case "uninstall":
        case "remove":
        case "rm":
        case "un":
          return deps.uninstallPackages(params.slice(1), ctx);
        case "ls":
        case "list":
          return deps.listPackages(ctx);
        case "init":
        case "create":
          return deps.npmInitOrCreate(params.slice(1), sub, ctx);
        case "version":
        case "-v":
        case "--version":
          return { stdout: VERSIONS.NPM + "\n", stderr: "", exitCode: 0 };
        case "info":
        case "view":
        case "show":
          return deps.npmInfo(params.slice(1), ctx);
        case "exec":
          return deps.npxExecute(params.slice(1), ctx);
        case "prefix":
          return { stdout: ctx.cwd + "\n", stderr: "", exitCode: 0 };
        case "root":
          return {
            stdout: ctx.cwd + "/node_modules\n",
            stderr: "",
            exitCode: 0,
          };
        case "bin":
          return {
            stdout: ctx.cwd + "/node_modules/.bin\n",
            stderr: "",
            exitCode: 0,
          };
        case "pack":
          return deps.npmPack(ctx);
        case "config":
        case "c":
          return deps.npmConfig(params.slice(1), ctx);
        case "outdated":
          return {
            stdout: "",
            stderr: deps.formatWarn(
              "outdated check not available in nodepod",
              "npm",
            ),
            exitCode: 0,
          };
        case "audit":
          return {
            stdout: "found 0 vulnerabilities\n",
            stderr: "",
            exitCode: 0,
          };
        case "fund":
          return {
            stdout: "0 packages are looking for funding\n",
            stderr: "",
            exitCode: 0,
          };
        case "cache":
          if (params[1] === "clean" || params[1] === "clear") {
            return { stdout: "Cache cleared.\n", stderr: "", exitCode: 0 };
          }
          return {
            stdout: "",
            stderr: deps.formatErr(
              `cache: unknown subcommand ${params[1] ?? ""}`,
              "npm",
            ),
            exitCode: 1,
          };
        case "whoami":
          return { stdout: "nodepod-user\n", stderr: "", exitCode: 0 };
        case "ping":
          return {
            stdout: `PING ${NPM_REGISTRY_URL_SLASH} - ok\n`,
            stderr: "",
            exitCode: 0,
          };
        case "set-script": {
          const scriptName = params[1];
          const scriptCmd = params.slice(2).join(" ");
          if (!scriptName || !scriptCmd) {
            return {
              stdout: "",
              stderr: deps.formatErr(
                "Usage: npm set-script <name> <command>",
                "npm",
              ),
              exitCode: 1,
            };
          }
          try {
            const pkgPath = ctx.cwd + "/package.json";
            const raw = deps.readFile(pkgPath);
            const pkg = JSON.parse(raw);
            if (!pkg.scripts) pkg.scripts = {};
            pkg.scripts[scriptName] = scriptCmd;
            deps.writeFile(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
            return {
              stdout: "",
              stderr: deps.formatWarn(
                "`set-script` is deprecated. Use `npm pkg set scripts.${scriptName}=\"${scriptCmd}\"` instead.",
                "npm",
              ),
              exitCode: 0,
            };
          } catch (e: any) {
            return {
              stdout: "",
              stderr: deps.formatErr(
                e.message || "Failed to update package.json",
                "npm",
              ),
              exitCode: 1,
            };
          }
        }
        case "pkg":
          return deps.npmPkg ? deps.npmPkg(params.slice(1), ctx) : {
            stdout: "",
            stderr: deps.formatErr("npm pkg not implemented", "npm"),
            exitCode: 1,
          };
        default:
          return {
            stdout: "",
            stderr: deps.formatErr(`Unknown command "${sub}"`, "npm"),
            exitCode: 1,
          };
      }
    },
  };
}
