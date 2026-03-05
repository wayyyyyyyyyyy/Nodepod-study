import { Nodepod, NodepodTerminal } from "../src/index";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

const statusEl = document.querySelector("#status") as HTMLSpanElement;
const bootBtn = document.querySelector("#boot-btn") as HTMLButtonElement;
const installBtn = document.querySelector("#install-btn") as HTMLButtonElement;
const runBtn = document.querySelector("#run-btn") as HTMLButtonElement;
const clearBtn = document.querySelector("#clear-btn") as HTMLButtonElement;
const cmdInput = document.querySelector("#cmd-input") as HTMLInputElement;

let nodepod: Nodepod | null = null;
let terminal: NodepodTerminal | null = null;

function setStatus(text: string): void {
  statusEl.textContent = text;
}

function sendCommand(command: string): void {
  if (!terminal) return;
  const trimmed = command.trim();
  if (!trimmed) return;
  terminal.input(trimmed + "\r");
}

async function bootRuntime(): Promise<void> {
  if (nodepod) return;
  setStatus("Booting Nodepod...");
  bootBtn.disabled = true;

  try {
    const corsProxyUrl = new URL("/__cors_proxy__/", location.origin).toString();
    try {
      localStorage.setItem("__corsProxyUrl", corsProxyUrl);
    } catch {
      // ignore storage issues in private mode
    }

    nodepod = await Nodepod.boot({
      workdir: "/workspace",
      env: {
        HOME: "/home/user",
        NODEPOD_CORS_PROXY_URL: corsProxyUrl,
      },
      files: {
        "/workspace/package.json": JSON.stringify(
          {
            name: "browser-cli",
            private: true,
            version: "0.0.0",
          },
          null,
          2,
        ),
      },
    });

    terminal = nodepod.createTerminal({ Terminal, FitAddon });
    terminal.attach("#terminal");
    terminal.showPrompt();

    installBtn.disabled = false;
    runBtn.disabled = false;
    clearBtn.disabled = false;
    setStatus(`Ready. Nodepod booted with CORS relay: ${corsProxyUrl}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    setStatus(`Boot failed: ${message}`);
    bootBtn.disabled = false;
  }
}

bootBtn.addEventListener("click", () => {
  void bootRuntime();
});

installBtn.addEventListener("click", () => {
  const installAndRun = [
    "mkdir -p /home/user/.pi/agent",
    "cd /home/user/.pi/agent",
    "rm -f auth.json models.json",
    "HOME=/home/user npm init -y",
    "HOME=/home/user npm install @mariozechner/pi-coding-agent",
    "export PI_BASE_URL=\"${PI_BASE_URL:-https://api.moonshot.cn/v1}\"",
    "export PI_MODEL_ID=\"${PI_MODEL_ID:-kimi-k2-turbo-preview}\"",
    "export PI_API_KEY=\"${PI_API_KEY:-}\"",
    "node -e 'const fs=require(\"fs\");const path=\"/home/user/.pi/agent/models.json\";const baseUrl=process.env.PI_BASE_URL||\"https://api.moonshot.cn/v1\";const model=process.env.PI_MODEL_ID||\"kimi-k2-turbo-preview\";const cfg={providers:{\"custom-openai\":{api:\"openai-completions\",baseUrl,apiKey:\"PI_API_KEY\",authHeader:true,models:[{id:model,name:model,contextWindow:128000,reasoning:false}]}}};fs.writeFileSync(path,JSON.stringify(cfg,null,2));console.log(`models.json written: ${path}`);'",
    "cat /home/user/.pi/agent/models.json",
    "CLI=/home/user/.pi/agent/node_modules/@mariozechner/pi-coding-agent/dist/cli.js",
    "ls -la \"$CLI\"",
    "HOME=/home/user node \"$CLI\" --list-models",
    "if [ -z \"$PI_API_KEY\" ]; then echo \"PI_API_KEY is empty. Set it before running install (export PI_API_KEY=...).\"; exit 1; fi",
    "HOME=/home/user NODEPOD_NO_INTERACTIVE_TIMEOUT=1 node \"$CLI\" --provider custom-openai --model \"$PI_MODEL_ID\"",
  ].join(" && ");

  sendCommand(installAndRun);
  setStatus("Running install + writing custom models.json + starting Pi...");
});

runBtn.addEventListener("click", () => {
  sendCommand(cmdInput.value);
});

cmdInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    sendCommand(cmdInput.value);
  }
});

clearBtn.addEventListener("click", () => {
  terminal?.clear();
  terminal?.showPrompt();
});
