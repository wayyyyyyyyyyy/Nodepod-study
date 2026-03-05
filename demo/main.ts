import { Nodepod, NodepodTerminal } from "../src/index";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

const statusEl = document.querySelector("#status") as HTMLSpanElement;
const installBtn = document.querySelector("#install-btn") as HTMLButtonElement;
const applyEnvBtn = document.querySelector("#apply-env-btn") as HTMLButtonElement;
const startAgentBtn = document.querySelector("#start-agent-btn") as HTMLButtonElement;
const toggleTerminalBtn = document.querySelector("#toggle-terminal-btn") as HTMLButtonElement;
const runBtn = document.querySelector("#run-btn") as HTMLButtonElement;
const clearBtn = document.querySelector("#clear-btn") as HTMLButtonElement;
const refreshFilesBtn = document.querySelector("#refresh-files-btn") as HTMLButtonElement;
const cmdInput = document.querySelector("#cmd-input") as HTMLInputElement;
const chatLogEl = document.querySelector("#chat-log") as HTMLDivElement;
const terminalPanelEl = document.querySelector("#terminal-panel") as HTMLElement;
const fileTreeEl = document.querySelector("#file-tree") as HTMLDivElement;

const envDialog = document.querySelector("#env-dialog") as HTMLDialogElement;
const envForm = document.querySelector("#env-form") as HTMLFormElement;
const envCancelBtn = document.querySelector("#env-cancel-btn") as HTMLButtonElement;
const apiKeyInput = document.querySelector("#api-key-input") as HTMLInputElement;
const baseUrlInput = document.querySelector("#base-url-input") as HTMLInputElement;
const modelIdInput = document.querySelector("#model-id-input") as HTMLInputElement;

const DEFAULT_BASE_URL = "https://api.moonshot.cn/v1";
const DEFAULT_MODEL_ID = "kimi-k2-turbo-preview";
const MAX_TREE_DEPTH = 4;
const MAX_DIR_ITEMS = 80;
const SKIP_RECURSE_DIRS = new Set(["node_modules", ".git"]);
const AGENT_PARTIAL_FLUSH_MS = 220;
const AGENT_SETTLE_MS = 1400;
const AGENT_STREAM_BUFFER_LIMIT = 12000;
const AGENT_NOISE_PATTERNS: RegExp[] = [
  /^escape to interrupt$/i,
  /^ctrl\+c to clear$/i,
  /^ctrl\+c twice to exit$/i,
  /^ctrl\+d to exit/i,
  /^ctrl\+z to suspend$/i,
  /^ctrl\+k to delete to end$/i,
  /^shift\+tab to cycle thinking level$/i,
  /^ctrl\+p\/shift\+ctrl\+p to cycle models$/i,
  /^ctrl\+l to select model$/i,
  /^ctrl\+o to expand tools$/i,
  /^ctrl\+t to expand thinking$/i,
  /^ctrl\+g for external editor$/i,
  /^\/ for commands$/i,
  /^! to run bash$/i,
  /^!! to run bash/i,
  /^alt\+enter to queue follow-up$/i,
  /^alt\+up to edit all queued messages$/i,
  /^ctrl\+v to paste image$/i,
  /^drop files to attach$/i,
  /^~\/\.pi\/agent$/i,
  /^~\/\.pi\/agent8;;$/i,
  /^nodepod:.*\$$/i,
  /^\d+(\.\d+)?%\/\d+/,
  /^↑\d+\s+↓\d+/,
  /^[─━-]{20,}$/,
  /^[⠋⠙⠧⠹⠸⠼⠴⠦⠇⠏]\s+Working\.\.\.$/,
  /^[\w.-]+\s+[•·]\s+(?:low|medium|high)$/i,
  /^pi v\d+\.\d+\.\d+$/i,
];
const IMPORTANT_AGENT_OUTPUT = /error|failed|invalid|401|authentication|timeout|connection/i;

type AgentConfig = {
  apiKey: string;
  baseUrl: string;
  modelId: string;
};

type TreeNode = {
  path: string;
  name: string;
  isDirectory: boolean;
  skipped?: boolean;
  truncated?: boolean;
  children?: TreeNode[];
};

type StatusState = "idle" | "loading" | "success" | "error";

let nodepod: Nodepod | null = null;
let terminal: NodepodTerminal | null = null;
let appliedConfig: AgentConfig | null = null;
let installReady = false;
let terminalVisible = false;
let agentSessionStarted = false;
let liveAgentBubble: HTMLDivElement | null = null;
let pendingInstallSentinelPath: string | null = null;
let installPollTimer: number | null = null;
let installPollStartedAt = 0;
let pendingStart = false;
let pendingStartBuffer = "";
let startWatchdogTimer: number | null = null;
let agentStreamBuffer = "";
let agentPartialFlushTimer: number | null = null;
let agentSettleTimer: number | null = null;
let lastAgentLine = "";
let awaitingAgentReply = false;
let agentEscapeCarry = "";

function updateStartButtonState(): void {
  startAgentBtn.disabled = !(!!appliedConfig && installReady && !pendingStart && !pendingInstallSentinelPath);
}

function setStatus(text: string, state: StatusState = "idle"): void {
  statusEl.textContent = text;
  statusEl.dataset.state = state;
}

function sendCommand(command: string): void {
  if (!terminal) return;
  const trimmed = command.trim();
  if (!trimmed) return;
  terminal.input(trimmed + "\r");
}

function normalizeField(value: string): string {
  return value.replace(/[\r\n]+/g, "").trim();
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function stripBackspaces(value: string): string {
  let out = "";
  for (const ch of value) {
    if (ch === "\b") {
      out = out.slice(0, -1);
      continue;
    }
    out += ch;
  }
  return out;
}

function splitIncompleteEscapeTail(input: string): { text: string; carry: string } {
  if (!input) return { text: input, carry: "" };

  let text = input;
  let carry = "";

  const oscStart = text.lastIndexOf("\x1b]");
  if (oscStart !== -1) {
    const tail = text.slice(oscStart);
    const hasBel = tail.includes("\x07");
    const hasSt = tail.includes("\x1b\\");
    if (!hasBel && !hasSt) {
      carry = tail;
      text = text.slice(0, oscStart);
      return { text, carry };
    }
  }

  const csiTail = text.match(/\x1b\[[0-?]*[ -/]*$/);
  if (csiTail) {
    carry = csiTail[0];
    text = text.slice(0, -carry.length);
    return { text, carry };
  }

  if (text.endsWith("\x1b")) {
    carry = "\x1b";
    text = text.slice(0, -1);
  }

  return { text, carry };
}

function normalizeAgentChunk(raw: string): string {
  if (!raw) return "";

  let source = agentEscapeCarry + raw;
  const { text, carry } = splitIncompleteEscapeTail(source);
  source = text;
  agentEscapeCarry = carry;

  // Strip OSC first (e.g. OSC 8 hyperlinks), then generic ANSI.
  source = source
    .replace(/\x1b\]8;[^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\x1b[@-Z\\-_]/g, "")
    .replace(/\x1b\[200~/g, "")
    .replace(/\x1b\[201~/g, "")
    .replace(/\r\n/g, "\n");

  // Keep only the latest carriage-overwritten segment in each visual line.
  source = source
    .split("\n")
    .map((line) => line.split("\r").pop() ?? "")
    .join("\n");

  const clean = stripBackspaces(
    source
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001a\u001c-\u001f\u007f]/g, "")
      .replace(/\]?8;;/g, ""),
  );

  if (!clean) return "";
  return clean.length > AGENT_STREAM_BUFFER_LIMIT ? clean.slice(-AGENT_STREAM_BUFFER_LIMIT) : clean;
}

function scrollChatToBottom(): void {
  chatLogEl.scrollTop = chatLogEl.scrollHeight;
}

function createChatMessage(role: "system" | "user" | "agent", text = ""): HTMLDivElement {
  const message = document.createElement("div");
  message.className = `chat-message ${role}`;
  message.dataset.role = role;
  message.textContent = text;
  return message;
}

function appendChatMessage(role: "system" | "user" | "agent", text: string): HTMLDivElement {
  const message = createChatMessage(role, text);
  chatLogEl.appendChild(message);
  scrollChatToBottom();
  return message;
}

function clearAgentPartialFlushTimer(): void {
  if (agentPartialFlushTimer !== null) {
    window.clearTimeout(agentPartialFlushTimer);
    agentPartialFlushTimer = null;
  }
}

function clearAgentSettleTimer(): void {
  if (agentSettleTimer !== null) {
    window.clearTimeout(agentSettleTimer);
    agentSettleTimer = null;
  }
}

function resetAgentStreamState(): void {
  clearAgentPartialFlushTimer();
  clearAgentSettleTimer();
  agentStreamBuffer = "";
  lastAgentLine = "";
  awaitingAgentReply = false;
  resetLiveAgentBubble();
}

function shouldIgnoreAgentLine(trimmedLine: string): boolean {
  if (!trimmedLine) return true;
  return AGENT_NOISE_PATTERNS.some((pattern) => pattern.test(trimmedLine));
}

function appendAgentLine(line: string): void {
  const normalized = line.replace(/[ \t]+$/g, "");
  const trimmed = normalized.trim();
  if (shouldIgnoreAgentLine(trimmed)) return;
  if (trimmed === lastAgentLine) return;

  if (!liveAgentBubble) {
    liveAgentBubble = appendChatMessage("agent", "");
  }
  if (liveAgentBubble.textContent && !liveAgentBubble.textContent.endsWith("\n")) {
    liveAgentBubble.textContent += "\n";
  }
  liveAgentBubble.textContent += trimmed;
  lastAgentLine = trimmed;
  scrollChatToBottom();
}

function flushAgentBuffer(forceRemainder = false): void {
  while (true) {
    const newlineIndex = agentStreamBuffer.indexOf("\n");
    if (newlineIndex === -1) break;
    const line = agentStreamBuffer.slice(0, newlineIndex);
    agentStreamBuffer = agentStreamBuffer.slice(newlineIndex + 1);
    appendAgentLine(line);
  }

  if (forceRemainder) {
    const tail = agentStreamBuffer.trim();
    if (tail) appendAgentLine(tail);
    agentStreamBuffer = "";
  }
}

function scheduleAgentPartialFlush(): void {
  clearAgentPartialFlushTimer();
  agentPartialFlushTimer = window.setTimeout(() => {
    flushAgentBuffer(true);
  }, AGENT_PARTIAL_FLUSH_MS);
}

function settleAgentReply(): void {
  flushAgentBuffer(true);
  awaitingAgentReply = false;
  resetLiveAgentBubble();
  clearAgentSettleTimer();
  if (agentSessionStarted) {
    setStatus("Agent ready.", "success");
  }
}

function scheduleAgentSettle(): void {
  clearAgentSettleTimer();
  agentSettleTimer = window.setTimeout(() => {
    settleAgentReply();
  }, AGENT_SETTLE_MS);
}

function beginAgentReply(): void {
  awaitingAgentReply = true;
  lastAgentLine = "";
  agentStreamBuffer = "";
  clearAgentPartialFlushTimer();
  clearAgentSettleTimer();
  resetLiveAgentBubble();
  setStatus("Waiting for agent output...", "loading");
}

function appendAgentOutput(raw: string): void {
  if (!agentSessionStarted && !pendingStart) return;

  const clean = normalizeAgentChunk(raw);
  if (!clean) return;

  if (!awaitingAgentReply && !IMPORTANT_AGENT_OUTPUT.test(clean)) {
    return;
  }

  agentStreamBuffer += clean;
  if (agentStreamBuffer.length > AGENT_STREAM_BUFFER_LIMIT) {
    agentStreamBuffer = agentStreamBuffer.slice(-AGENT_STREAM_BUFFER_LIMIT);
  }

  flushAgentBuffer(false);
  scheduleAgentPartialFlush();
  scheduleAgentSettle();
}

function resetLiveAgentBubble(): void {
  liveAgentBubble = null;
}

function createDoneToken(prefix: string): string {
  return `__NODEPOD_${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}__`;
}

function clearInstallPolling(): void {
  if (installPollTimer !== null) {
    window.clearTimeout(installPollTimer);
    installPollTimer = null;
  }
}

function finishInstall(exitCode: number): void {
  pendingInstallSentinelPath = null;
  clearInstallPolling();
  installBtn.disabled = false;
  installReady = exitCode === 0;
  updateStartButtonState();

  if (exitCode === 0) {
    setStatus("Install completed.", "success");
    appendChatMessage("system", "Install completed.");
  } else {
    setStatus(`Install failed (exit ${exitCode}).`, "error");
    appendChatMessage("system", `Install failed (exit ${exitCode}). Check terminal logs.`);
  }

  void refreshFileTree();
}

async function pollInstallCompletion(): Promise<void> {
  if (!pendingInstallSentinelPath || !nodepod) return;

  const exists = await nodepod.fs.exists(pendingInstallSentinelPath).catch(() => false);
  if (exists) {
    const raw = await nodepod.fs.readFile(pendingInstallSentinelPath, "utf8").catch(() => "");
    const exitCode = Number(String(raw).trim());
    if (!Number.isNaN(exitCode)) {
      finishInstall(exitCode);
      return;
    }
  }

  if (Date.now() - installPollStartedAt > 180000) {
    pendingInstallSentinelPath = null;
    clearInstallPolling();
    installBtn.disabled = false;
    installReady = false;
    updateStartButtonState();
    setStatus("Install timeout. Open terminal to inspect logs.", "error");
    appendChatMessage("system", "Install timeout. Open terminal to inspect logs.");
    return;
  }

  installPollTimer = window.setTimeout(() => {
    void pollInstallCompletion();
  }, 1200);
}

function clearStartWatchdog(): void {
  if (startWatchdogTimer !== null) {
    window.clearTimeout(startWatchdogTimer);
    startWatchdogTimer = null;
  }
}

function finishStartSuccess(): void {
  pendingStart = false;
  pendingStartBuffer = "";
  clearStartWatchdog();
  updateStartButtonState();
  agentSessionStarted = true;
  resetAgentStreamState();
  setStatus("Agent CLI started.", "success");
  appendChatMessage("system", "Agent CLI started. You can chat below.");
}

function finishStartError(message: string): void {
  pendingStart = false;
  pendingStartBuffer = "";
  clearStartWatchdog();
  updateStartButtonState();
  agentSessionStarted = false;
  resetAgentStreamState();
  setStatus(message, "error");
  appendChatMessage("system", message);
}

function handleStartTracking(clean: string): void {
  if (!pendingStart) return;

  pendingStartBuffer += clean;
  if (pendingStartBuffer.length > 12000) {
    pendingStartBuffer = pendingStartBuffer.slice(-6000);
  }

  if (/\bpi v\d+/i.test(pendingStartBuffer)) {
    finishStartSuccess();
    return;
  }

  if (
    /Error:\s*401|Invalid Authentication|authentication_error|Unknown provider|models\.json error|Connection error/i.test(
      pendingStartBuffer,
    )
  ) {
    finishStartError("Agent CLI start failed. Check API key/model/baseUrl.");
  }
}

function handleWorkflowOutput(raw: string): void {
  const clean = normalizeAgentChunk(raw);
  if (!clean) return;
  handleStartTracking(clean);
}

function wireTerminalOutputMirror(term: NodepodTerminal): void {
  const t = term as any;
  if (t.__chatMirrorPatched) return;

  const originalWriteOutput = t._writeOutput?.bind(t);
  if (typeof originalWriteOutput === "function") {
    t._writeOutput = (text: string, isError = false) => {
      handleWorkflowOutput(String(text ?? ""));
      appendAgentOutput(String(text ?? ""));
      return originalWriteOutput(text, isError);
    };
  }

  t.__chatMirrorPatched = true;
}

function setTerminalVisible(nextVisible: boolean): void {
  terminalVisible = nextVisible;
  terminalPanelEl.classList.toggle("is-collapsed", !terminalVisible);
  toggleTerminalBtn.textContent = terminalVisible ? "Hide Terminal" : "Show Terminal";
  if (terminalVisible) {
    setTimeout(() => {
      terminal?.fit();
    }, 60);
  }
}

function readConfigInputs(): AgentConfig {
  const apiKey = normalizeField(apiKeyInput.value);
  const baseUrl = normalizeField(baseUrlInput.value) || DEFAULT_BASE_URL;
  const modelId = normalizeField(modelIdInput.value) || DEFAULT_MODEL_ID;
  return { apiKey, baseUrl, modelId };
}

function validateConfig(config: AgentConfig): string | null {
  if (!config.apiKey) return "API Key is required.";
  if (!config.baseUrl) return "Base URL is required.";
  if (!config.modelId) return "Model Name is required.";

  try {
    const parsed = new URL(config.baseUrl);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return "Base URL must start with http:// or https://";
    }
  } catch {
    return "Base URL is invalid.";
  }

  return null;
}

function syncRuntimeEnv(config: AgentConfig): void {
  nodepod?.setEnv({
    PI_API_KEY: config.apiKey,
    PI_BASE_URL: config.baseUrl,
    PI_MODEL_ID: config.modelId,
  });
}

function hasRuntimeApiKey(): boolean {
  if (!nodepod) return false;
  const value = nodepod.getEnv("PI_API_KEY");
  return typeof value === "string" && value.length > 0;
}

function buildExportCommand(config: AgentConfig): string {
  return [
    `export PI_API_KEY=${shellQuote(config.apiKey)}`,
    `export PI_BASE_URL=${shellQuote(config.baseUrl)}`,
    `export PI_MODEL_ID=${shellQuote(config.modelId)}`,
  ].join(" && ");
}

function buildInstallCommand(): string {
  return [
    "mkdir -p /home/user/.pi/agent",
    "cd /home/user/.pi/agent",
    "[ -f package.json ] || HOME=/home/user npm init -y",
    "HOME=/home/user npm install @mariozechner/pi-coding-agent",
    "node -e 'const fs=require(\"fs\");const path=\"/home/user/.pi/agent/models.json\";const baseUrl=process.env.PI_BASE_URL||\"https://api.moonshot.cn/v1\";const model=process.env.PI_MODEL_ID||\"kimi-k2-turbo-preview\";const apiKey=process.env.PI_API_KEY||\"PI_API_KEY\";const cfg={providers:{\"custom-openai\":{api:\"openai-completions\",baseUrl,apiKey,authHeader:true,models:[{id:model,name:model,contextWindow:128000,reasoning:false}]}}};fs.writeFileSync(path,JSON.stringify(cfg,null,2));console.log(`models.json written: ${path}`);'",
    "CLI=/home/user/.pi/agent/node_modules/@mariozechner/pi-coding-agent/dist/cli.js",
    "HOME=/home/user node \"$CLI\" --list-models",
  ].join(" && ");
}

function buildStartAgentCommand(): string {
  return [
    "cd /home/user/.pi/agent",
    "CLI=/home/user/.pi/agent/node_modules/@mariozechner/pi-coding-agent/dist/cli.js",
    "HOME=/home/user NODEPOD_NO_INTERACTIVE_TIMEOUT=1 node \"$CLI\" --provider custom-openai --model \"$PI_MODEL_ID\"",
  ].join(" && ");
}

async function readTreeNode(path: string, depth: number): Promise<TreeNode | null> {
  if (!nodepod) return null;

  const exists = await nodepod.fs.exists(path);
  if (!exists) return null;

  const stat = await nodepod.fs.stat(path);
  const name = path === "/" ? "/" : path.split("/").filter(Boolean).pop() ?? path;

  if (!stat.isDirectory) {
    return { path, name, isDirectory: false };
  }

  const node: TreeNode = { path, name, isDirectory: true, children: [] };

  if (depth <= 0) return node;
  if (SKIP_RECURSE_DIRS.has(name)) {
    node.skipped = true;
    return node;
  }

  let entries: string[];
  try {
    entries = await nodepod.fs.readdir(path);
  } catch {
    return node;
  }

  const sorted = entries
    .filter((entry) => entry && entry !== "." && entry !== "..")
    .sort((a, b) => a.localeCompare(b));

  const limited = sorted.slice(0, MAX_DIR_ITEMS);
  node.truncated = sorted.length > limited.length;

  for (const entry of limited) {
    const childPath = `${path}/${entry}`.replace(/\/{2,}/g, "/");
    const child = await readTreeNode(childPath, depth - 1);
    if (child) node.children?.push(child);
  }

  return node;
}

function renderTreeNode(node: TreeNode): HTMLLIElement {
  const li = document.createElement("li");

  if (!node.isDirectory) {
    const file = document.createElement("span");
    file.className = "tree-file";
    file.textContent = node.name;
    li.appendChild(file);
    return li;
  }

  const details = document.createElement("details");
  details.open = node.path === "/workspace" || node.path === "/home/user/.pi/agent";

  const summary = document.createElement("summary");
  summary.className = "tree-dir";
  summary.textContent = `${node.name}/`;
  if (node.skipped) summary.textContent += " (skipped)";
  if (node.truncated) summary.textContent += " (truncated)";
  details.appendChild(summary);

  if (node.children && node.children.length > 0) {
    const ul = document.createElement("ul");
    for (const child of node.children) {
      ul.appendChild(renderTreeNode(child));
    }
    details.appendChild(ul);
  }

  li.appendChild(details);
  return li;
}

async function refreshFileTree(): Promise<void> {
  if (!nodepod) {
    fileTreeEl.textContent = "Boot runtime to load files.";
    return;
  }

  refreshFilesBtn.disabled = true;
  fileTreeEl.textContent = "Loading files...";

  const roots = ["/workspace", "/home/user/.pi/agent"];
  const nodes: TreeNode[] = [];

  for (const root of roots) {
    const tree = await readTreeNode(root, MAX_TREE_DEPTH);
    if (tree) nodes.push(tree);
  }

  fileTreeEl.innerHTML = "";
  if (nodes.length === 0) {
    fileTreeEl.textContent = "No files found in selected roots.";
  } else {
    const ul = document.createElement("ul");
    for (const node of nodes) {
      const li = document.createElement("li");
      li.className = "tree-root";
      li.textContent = node.path;
      ul.appendChild(li);

      const inner = document.createElement("ul");
      if (node.children) {
        for (const child of node.children) {
          inner.appendChild(renderTreeNode(child));
        }
      }
      ul.appendChild(inner);
    }
    fileTreeEl.appendChild(ul);
  }

  refreshFilesBtn.disabled = false;
}

async function bootRuntime(): Promise<void> {
  if (nodepod) return;

  setStatus("Booting Nodepod runtime...", "loading");
  installBtn.disabled = true;
  installReady = false;
  updateStartButtonState();

  try {
    const corsProxyUrl = new URL("/__cors_proxy__/", location.origin).toString();

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
    wireTerminalOutputMirror(terminal);
    terminal.showPrompt();

    applyEnvBtn.disabled = false;
    updateStartButtonState();
    toggleTerminalBtn.disabled = false;
    runBtn.disabled = false;
    clearBtn.disabled = false;
    refreshFilesBtn.disabled = false;

    await refreshFileTree();
    setStatus("Runtime booted.", "success");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    setStatus(`Boot failed: ${message}`, "error");
    installBtn.disabled = false;
  }
}

function sendAgentPromptFromInput(): void {
  const prompt = cmdInput.value.trim();
  if (!prompt) return;

  if (!agentSessionStarted) {
    setStatus("Start Agent CLI first.", "idle");
    return;
  }

  appendChatMessage("user", prompt);
  beginAgentReply();
  sendCommand(prompt);
  cmdInput.value = "";
}

appendChatMessage("system", "LiveNode Agent ready flow: 1) Install Agent  2) Configure Env  3) Start CLI");
appendChatMessage("system", "Use this chat box as the main interaction pane.");
setStatus("Idle", "idle");
updateStartButtonState();

refreshFilesBtn.addEventListener("click", () => {
  void refreshFileTree();
});

toggleTerminalBtn.addEventListener("click", () => {
  setTerminalVisible(!terminalVisible);
});

applyEnvBtn.addEventListener("click", () => {
  if (!nodepod) {
    setStatus("Run Boot + Install first.", "idle");
    return;
  }

  if (typeof envDialog.showModal === "function") {
    envDialog.showModal();
  } else {
    envDialog.setAttribute("open", "true");
  }

  apiKeyInput.focus();
});

envCancelBtn.addEventListener("click", () => {
  envDialog.close();
});

envForm.addEventListener("submit", (event) => {
  event.preventDefault();

  if (!nodepod) {
    setStatus("Run Boot + Install first.", "idle");
    return;
  }

  const config = readConfigInputs();
  const validationError = validateConfig(config);
  if (validationError) {
    setStatus(validationError, "error");
    if (!config.apiKey) apiKeyInput.focus();
    else if (!config.baseUrl) baseUrlInput.focus();
    else modelIdInput.focus();
    return;
  }

  syncRuntimeEnv(config);
  appliedConfig = config;
  updateStartButtonState();
  envDialog.close();
  appendChatMessage("system", "Agent env applied.");
  setStatus("Agent env applied to runtime memory.", "success");
});

installBtn.addEventListener("click", async () => {
  installBtn.disabled = true;
  setStatus("Installing pi-coding-agent...", "loading");
  installReady = false;
  updateStartButtonState();

  if (!nodepod) {
    await bootRuntime();
    if (!nodepod) {
      installBtn.disabled = false;
      return;
    }
  }

  const doneToken = createDoneToken("INSTALL_DONE");
  const sentinelPath = `/tmp/${doneToken}.code`;
  pendingInstallSentinelPath = sentinelPath;
  clearInstallPolling();
  installPollStartedAt = Date.now();
  void pollInstallCompletion();

  if (appliedConfig) {
    syncRuntimeEnv(appliedConfig);
    sendCommand(
      `${buildExportCommand(appliedConfig)} && rm -f ${shellQuote(sentinelPath)} && ${buildInstallCommand()} ; echo $? > ${shellQuote(sentinelPath)}`,
    );
  } else {
    nodepod.setEnv({
      PI_BASE_URL: normalizeField(baseUrlInput.value) || DEFAULT_BASE_URL,
      PI_MODEL_ID: normalizeField(modelIdInput.value) || DEFAULT_MODEL_ID,
    });
    sendCommand(
      `rm -f ${shellQuote(sentinelPath)} && ${buildInstallCommand()} ; echo $? > ${shellQuote(sentinelPath)}`,
    );
  }

  appendChatMessage("system", "Installing agent dependencies...");
});

startAgentBtn.addEventListener("click", () => {
  if (!appliedConfig) {
    setStatus("Click Apply Agent Env and confirm first.", "idle");
    return;
  }
  if (!installReady) {
    setStatus("Install must complete before starting CLI.", "idle");
    return;
  }

  syncRuntimeEnv(appliedConfig);
  if (!hasRuntimeApiKey()) {
    setStatus("PI_API_KEY is missing in runtime. Re-apply Agent Env.", "error");
    return;
  }

  pendingStart = true;
  resetAgentStreamState();
  updateStartButtonState();
  pendingStartBuffer = "";
  clearStartWatchdog();
  startWatchdogTimer = window.setTimeout(() => {
    if (!pendingStart) return;
    finishStartError("Agent startup timeout. Retry Start Agent CLI or open terminal.");
  }, 12000);

  resetLiveAgentBubble();
  sendCommand(`${buildExportCommand(appliedConfig)} && ${buildStartAgentCommand()}`);
  setStatus("Starting Agent CLI...", "loading");
});

runBtn.addEventListener("click", () => {
  sendAgentPromptFromInput();
});

cmdInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    sendAgentPromptFromInput();
  }
});

clearBtn.addEventListener("click", () => {
  terminal?.clear();
  terminal?.showPrompt();
});
