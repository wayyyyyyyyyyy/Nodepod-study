import { Nodepod, NodepodTerminal } from "../src/index";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

const statusEl = document.querySelector("#status") as HTMLSpanElement;
const sessionMetaEl = document.querySelector("#session-meta") as HTMLSpanElement;
const installBtn = document.querySelector("#install-btn") as HTMLButtonElement;
const applyEnvBtn = document.querySelector("#apply-env-btn") as HTMLButtonElement;
const startAgentBtn = document.querySelector("#start-agent-btn") as HTMLButtonElement;
const toggleTerminalBtn = document.querySelector("#toggle-terminal-btn") as HTMLButtonElement;
const runBtn = document.querySelector("#run-btn") as HTMLButtonElement;
const clearBtn = document.querySelector("#clear-btn") as HTMLButtonElement;
const agentTerminalTabBtn = document.querySelector("#agent-terminal-tab") as HTMLButtonElement;
const workspaceTerminalTabBtn = document.querySelector(
  "#workspace-terminal-tab",
) as HTMLButtonElement;
const uploadFileBtn = document.querySelector("#upload-file-btn") as HTMLButtonElement;
const downloadFileBtn = document.querySelector("#download-file-btn") as HTMLButtonElement;
const fileSelectionEl = document.querySelector("#file-selection") as HTMLDivElement;
const fileUploadInput = document.querySelector("#file-upload-input") as HTMLInputElement;
const cmdInput = document.querySelector("#cmd-input") as HTMLInputElement;
const chatLogEl = document.querySelector("#chat-log") as HTMLDivElement;
const terminalPanelEl = document.querySelector("#terminal-panel") as HTMLElement;
const terminalHintEl = document.querySelector("#terminal-hint") as HTMLSpanElement;
const fileTreeEl = document.querySelector("#file-tree") as HTMLDivElement;
const agentTerminalEl = document.querySelector("#agent-terminal") as HTMLDivElement;
const workspaceTerminalEl = document.querySelector("#workspace-terminal") as HTMLDivElement;
const previewPanelEl = document.querySelector("#preview-panel") as HTMLElement;
const previewMetaEl = document.querySelector("#preview-meta") as HTMLSpanElement;
const previewPlaceholderEl = document.querySelector("#preview-placeholder") as HTMLDivElement;
const previewFrameEl = document.querySelector("#preview-frame") as HTMLIFrameElement;
const openPreviewBtn = document.querySelector("#open-preview-btn") as HTMLButtonElement;

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
const FILE_TREE_AUTO_REFRESH_MS = 12000;
const AGENT_REPLY_IDLE_MS = 1200;
const AGENT_REPLY_RECHECK_MS = 300;
const AGENT_STREAM_BUFFER_LIMIT = 120000;
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
const CLI_USAGE_MODEL_REGEX =
  /^(↑\d+\s+↓\d+\s+R\d+\s+[0-9.]+%\/[0-9.]+[kKmM]?\s+\(auto\))\s+(.+)$/;

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

type SessionMeta = {
  cwd: string;
  usage: string;
  model: string;
};

type PreviewState = "idle" | "ready" | "unavailable";

type PreviewTarget = {
  port: number;
  url: string;
};

type TerminalKind = "agent" | "workspace";

let nodepod: Nodepod | null = null;
let agentTerminal: NodepodTerminal | null = null;
let workspaceTerminal: NodepodTerminal | null = null;
let appliedConfig: AgentConfig | null = null;
let installReady = false;
let terminalVisible = false;
let activeTerminalKind: TerminalKind = "agent";
let agentSessionStarted = false;
let pendingInstallSentinelPath: string | null = null;
let installPollTimer: number | null = null;
let installPollStartedAt = 0;
let pendingStart = false;
let pendingStartBuffer = "";
let startWatchdogTimer: number | null = null;
let agentTranscript = "";
let agentSettleTimer: number | null = null;
let awaitingAgentReply = false;
let agentEscapeCarry = "";
let lastUserPrompt = "";
let agentExtractCursor = 0;
let agentReplyStartedAt = 0;
let selectedTreePath: string | null = null;
let selectedTreeIsDirectory = false;
let fileTreeRefreshInFlight = false;
let fileTreeAutoRefreshTimer: number | null = null;
let previewState: PreviewState = "idle";
let previewMessage = "Run a local server in the terminal to open a live preview.";
let activePreview: PreviewTarget | null = null;
const announcedPreviewPorts = new Set<number>();
const sessionMeta: SessionMeta = {
  cwd: "",
  usage: "",
  model: "",
};

function updateChatControlsState(): void {
  cmdInput.disabled = !agentSessionStarted;
  runBtn.disabled = !agentSessionStarted || awaitingAgentReply;
}

function updateFileActionState(): void {
  uploadFileBtn.disabled = !nodepod;
  downloadFileBtn.disabled = !nodepod || !selectedTreePath || selectedTreeIsDirectory;
  fileSelectionEl.textContent = selectedTreePath
    ? `Selected: ${selectedTreePath}${selectedTreeIsDirectory ? " (directory)" : ""}`
    : "Selected: none";
}

function updateStartButtonState(): void {
  startAgentBtn.disabled = !(!!appliedConfig && installReady && !pendingStart && !pendingInstallSentinelPath);
}

function setStatus(text: string, state: StatusState = "idle"): void {
  statusEl.textContent = text;
  statusEl.dataset.state = state;
}

function getTerminal(kind: TerminalKind): NodepodTerminal | null {
  return kind === "agent" ? agentTerminal : workspaceTerminal;
}

function getActiveTerminal(): NodepodTerminal | null {
  return getTerminal(activeTerminalKind);
}

function updateTerminalTabState(): void {
  agentTerminalTabBtn.classList.toggle("is-active", activeTerminalKind === "agent");
  workspaceTerminalTabBtn.classList.toggle("is-active", activeTerminalKind === "workspace");
  agentTerminalEl.classList.toggle("is-hidden", activeTerminalKind !== "agent");
  workspaceTerminalEl.classList.toggle("is-hidden", activeTerminalKind !== "workspace");

  terminalHintEl.textContent =
    activeTerminalKind === "agent"
      ? "Agent Terminal is reserved for install logs and the running CLI."
      : "Workspace Terminal is for manual commands like vite, npm, and git.";
}

function fitActiveTerminal(): void {
  getActiveTerminal()?.fit();
}

function setActiveTerminal(kind: TerminalKind): void {
  activeTerminalKind = kind;
  updateTerminalTabState();
  if (terminalVisible) {
    setTimeout(() => {
      fitActiveTerminal();
    }, 60);
  }
}

function buildPreviewUrl(port: number, rawUrl?: string): string {
  if (rawUrl) {
    try {
      const parsed = new URL(rawUrl, location.origin);
      parsed.pathname = `/__preview__/${port}/`;
      parsed.search = "";
      parsed.hash = "";
      return parsed.toString();
    } catch {
      /* ignore and fall back */
    }
  }

  return new URL(`/__preview__/${port}/`, location.origin).toString();
}

function renderPreviewState(): void {
  previewPanelEl.dataset.state = previewState;
  previewMetaEl.textContent = activePreview
    ? `Port ${activePreview.port} is ready inside the browser runtime.`
    : previewMessage;
  previewPlaceholderEl.textContent = previewMessage;
  openPreviewBtn.disabled = !activePreview;

  if (activePreview) {
    previewFrameEl.hidden = false;
    if (previewFrameEl.src !== activePreview.url) {
      previewFrameEl.src = activePreview.url;
    }
    return;
  }

  previewFrameEl.hidden = true;
  previewFrameEl.removeAttribute("src");
}

function setPreviewIdle(message = "Run a local server in the terminal to open a live preview."): void {
  previewState = "idle";
  previewMessage = message;
  activePreview = null;
  renderPreviewState();
}

function setPreviewUnavailable(message: string): void {
  previewState = "unavailable";
  previewMessage = message;
  activePreview = null;
  renderPreviewState();
}

function setPreviewTarget(port: number, rawUrl?: string): void {
  activePreview = {
    port,
    url: buildPreviewUrl(port, rawUrl),
  };
  previewState = "ready";
  previewMessage = `Port ${port} is ready inside the browser runtime.`;
  renderPreviewState();

  if (!announcedPreviewPorts.has(port)) {
    announcedPreviewPorts.add(port);
    appendChatMessage("system", `Preview ready on port ${port}.`);
  }

  setStatus(`Preview ready on port ${port}.`, "success");
}

function sendCommand(command: string, terminalKind: TerminalKind = "agent"): void {
  const terminal = getTerminal(terminalKind);
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
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");

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

function sanitizeUploadName(name: string): string {
  return name.replace(/[\\/]+/g, "-").trim() || "upload.bin";
}

function joinFsPath(base: string, child: string): string {
  return `${base.replace(/\/+$/, "")}/${child.replace(/^\/+/, "")}`.replace(/\/{2,}/g, "/");
}

function dirname(path: string): string {
  const normalized = path.replace(/\/+$/, "");
  const index = normalized.lastIndexOf("/");
  if (index <= 0) return "/";
  return normalized.slice(0, index);
}

function setSelectedTreeNode(path: string | null, isDirectory = false): void {
  selectedTreePath = path;
  selectedTreeIsDirectory = !!path && isDirectory;

  fileTreeEl.querySelectorAll<HTMLElement>("[data-tree-selected='true']").forEach((el) => {
    el.dataset.treeSelected = "false";
  });

  if (path) {
    const selector = `[data-tree-path="${CSS.escape(path)}"]`;
    const active = fileTreeEl.querySelector<HTMLElement>(selector);
    if (active) active.dataset.treeSelected = "true";
  }

  updateFileActionState();
}

function startFileTreeAutoRefresh(): void {
  if (fileTreeAutoRefreshTimer !== null) return;
  fileTreeAutoRefreshTimer = window.setInterval(() => {
    void refreshFileTree({ silent: true });
  }, FILE_TREE_AUTO_REFRESH_MS);
}

function clearAgentSettleTimer(): void {
  if (agentSettleTimer !== null) {
    window.clearTimeout(agentSettleTimer);
    agentSettleTimer = null;
  }
}

function renderSessionMeta(): void {
  if (!sessionMetaEl) return;
  const parts: string[] = [];
  if (sessionMeta.cwd) parts.push(sessionMeta.cwd);
  if (sessionMeta.usage) parts.push(sessionMeta.usage);
  if (sessionMeta.model) parts.push(sessionMeta.model);
  sessionMetaEl.textContent = parts.length > 0 ? parts.join(" | ") : "Session info will appear here.";
}

function updateSessionMetaFromChunk(clean: string): void {
  const lines = clean
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  let changed = false;
  for (const line of lines) {
    if (/^~\/\S+/.test(line) && sessionMeta.cwd !== line) {
      sessionMeta.cwd = line;
      changed = true;
      continue;
    }

    const usageModel = line.match(CLI_USAGE_MODEL_REGEX);
    if (usageModel) {
      if (sessionMeta.usage !== usageModel[1]) {
        sessionMeta.usage = usageModel[1];
        changed = true;
      }
      const model = usageModel[2].trim();
      if (model && sessionMeta.model !== model) {
        sessionMeta.model = model;
        changed = true;
      }
      continue;
    }
  }

  if (changed) renderSessionMeta();
}

function resetAgentStreamState(): void {
  clearAgentSettleTimer();
  agentTranscript = "";
  awaitingAgentReply = false;
  lastUserPrompt = "";
  agentEscapeCarry = "";
  agentExtractCursor = 0;
  agentReplyStartedAt = 0;
}

function shouldIgnoreAgentLine(trimmedLine: string): boolean {
  if (!trimmedLine) return true;
  return AGENT_NOISE_PATTERNS.some((pattern) => pattern.test(trimmedLine));
}

function isLikelyIncrementalFrame(prevRaw: string, nextRaw: string): boolean {
  const prev = prevRaw.trim();
  const next = nextRaw.trim();
  if (!prev || !next) return false;

  if (/^\s*[-*]\s/.test(prevRaw) || /^\s*[-*]\s/.test(nextRaw)) return false;

  const shorter = prev.length <= next.length ? prev : next;
  const longer = prev.length <= next.length ? next : prev;
  if (!longer.startsWith(shorter)) return false;

  const delta = longer.length - shorter.length;
  return delta > 0 && delta <= 24;
}

function normalizeExtractedLines(lines: string[], promptText: string): string {
  const kept: string[] = [];
  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) {
      if (kept.length > 0 && kept[kept.length - 1] !== "") kept.push("");
      continue;
    }
    if (promptText && trimmed === promptText) continue;
    if (shouldIgnoreAgentLine(trimmed)) continue;
    kept.push(rawLine);
  }

  const deduped: string[] = [];
  for (const rawLine of kept) {
    const line = rawLine.trim();
    if (deduped.length === 0) {
      deduped.push(rawLine);
      continue;
    }

    const prevRaw = deduped[deduped.length - 1];
    const prev = prevRaw.trim();

    if (!line && !prev) continue;
    if (line === prev) continue;

    if (isLikelyIncrementalFrame(prevRaw, rawLine)) {
      deduped[deduped.length - 1] = line.length >= prev.length ? rawLine : prevRaw;
      continue;
    }

    deduped.push(rawLine);
  }

  while (deduped.length > 0 && deduped[0] === "") deduped.shift();
  while (deduped.length > 0 && deduped[deduped.length - 1] === "") deduped.pop();
  return deduped.join("\n").trim();
}

function extractFinalAgentText(
  transcript: string,
  cursor: number,
  prompt: string,
): { text: string; nextCursor: number } {
  const promptText = prompt.trim();
  const safeCursor = Math.max(0, Math.min(cursor, transcript.length));
  const scoped = transcript.slice(safeCursor);
  if (!scoped.trim()) {
    return { text: "", nextCursor: transcript.length };
  }

  const scopedLines = scoped.split("\n");
  let startLine = 0;
  if (promptText) {
    const promptLineAt = scopedLines.findIndex((line, idx) => idx < 8 && line.trim() === promptText);
    if (promptLineAt !== -1) {
      startLine = promptLineAt + 1;
      while (startLine < scopedLines.length && scopedLines[startLine].trim() === "") {
        startLine += 1;
      }
    }
  }

  const extractedRaw = scopedLines.slice(startLine).join("\n");
  const lines = extractedRaw
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""));
  const text = normalizeExtractedLines(lines, promptText);
  return { text, nextCursor: transcript.length };
}

function readAgentTerminalText(): string {
  const xterm = agentTerminal?.xterm as any;
  const active = xterm?.buffer?.active;
  if (!xterm || !active) return "";

  const rows = typeof xterm.rows === "number" ? xterm.rows : 24;
  const viewportY =
    typeof active.viewportY === "number"
      ? active.viewportY
      : typeof active.ydisp === "number"
        ? active.ydisp
        : Math.max(0, (active.length ?? rows) - rows);
  const start = Math.max(0, viewportY);
  const end = Math.min((active.length ?? rows) - 1, start + rows - 1);
  const lines: string[] = [];

  for (let index = start; index <= end; index += 1) {
    const line = active.getLine(index);
    if (!line) continue;
    lines.push(String(line.translateToString(true) ?? "").replace(/[ \t]+$/g, ""));
  }

  return lines.join("\n").trim();
}

function terminalReplyStillWorking(screenText: string): boolean {
  return /(?:^|\n)\s*[⠋⠙⠧⠹⠸⠼⠴⠦⠇⠏]?\s*Working\.\.\.(?:\n|$)/i.test(screenText);
}

function extractFinalAgentTextFromScreen(screenText: string, prompt: string): string {
  if (!screenText.trim()) return "";
  const promptText = prompt.trim();
  const lines = screenText.split("\n").map((line) => line.replace(/[ \t]+$/g, ""));

  if (!promptText) {
    return normalizeExtractedLines(lines, "");
  }

  let startLine = -1;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (lines[index].trim() === promptText) {
      startLine = index + 1;
      break;
    }
  }

  if (startLine === -1) return "";
  return normalizeExtractedLines(lines.slice(startLine), promptText);
}

function settleAgentReply(): void {
  if (!awaitingAgentReply) return;

  const screenText = readAgentTerminalText();
  if (terminalReplyStillWorking(screenText) && Date.now() - agentReplyStartedAt < 30000) {
    clearAgentSettleTimer();
    agentSettleTimer = window.setTimeout(() => {
      settleAgentReply();
    }, AGENT_REPLY_RECHECK_MS);
    return;
  }

  awaitingAgentReply = false;
  clearAgentSettleTimer();
  updateChatControlsState();

  const screenTextReply = extractFinalAgentTextFromScreen(screenText, lastUserPrompt);
  const { text: finalText, nextCursor } = extractFinalAgentText(
    agentTranscript,
    agentExtractCursor,
    lastUserPrompt,
  );
  const resolvedReply = screenTextReply || finalText;

  if (resolvedReply) {
    appendChatMessage("agent", resolvedReply);
  } else if (agentTranscript.trim()) {
    const fallback = agentTranscript
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(-4)
      .join("\n");
    if (fallback) appendChatMessage("agent", fallback);
  }

  agentExtractCursor = nextCursor;
  lastUserPrompt = "";
  if (agentSessionStarted) {
    setStatus("Agent ready.", "success");
  }
}

function scheduleAgentSettle(): void {
  clearAgentSettleTimer();
  agentSettleTimer = window.setTimeout(() => {
    settleAgentReply();
  }, AGENT_REPLY_IDLE_MS);
}

function beginAgentReply(prompt: string): void {
  awaitingAgentReply = true;
  agentReplyStartedAt = Date.now();
  lastUserPrompt = prompt.trim();
  agentEscapeCarry = "";
  clearAgentSettleTimer();
  updateChatControlsState();
  setStatus("Agent is thinking...", "loading");
}

function collectAgentOutput(clean: string): void {
  if (!agentSessionStarted && !pendingStart) return;
  if (!clean) return;
  updateSessionMetaFromChunk(clean);

  if (!awaitingAgentReply) {
    return;
  }

  agentTranscript += clean;
  if (agentTranscript.length > AGENT_STREAM_BUFFER_LIMIT) {
    const overflow = agentTranscript.length - AGENT_STREAM_BUFFER_LIMIT;
    agentTranscript = agentTranscript.slice(overflow);
    agentExtractCursor = Math.max(0, agentExtractCursor - overflow);
  }

  scheduleAgentSettle();
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
  updateChatControlsState();
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
  updateChatControlsState();
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

function handleWorkflowOutput(clean: string): void {
  if (!clean) return;
  handleStartTracking(clean);
}

function wireTerminalOutputMirror(term: NodepodTerminal): void {
  const t = term as any;
  if (t.__chatMirrorPatched) return;

  const originalWriteOutput = t._writeOutput?.bind(t);
  if (typeof originalWriteOutput === "function") {
    t._writeOutput = (text: string, isError = false) => {
      const clean = normalizeAgentChunk(String(text ?? ""));
      if (clean) {
        handleWorkflowOutput(clean);
        collectAgentOutput(clean);
      }
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
      fitActiveTerminal();
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
    const file = document.createElement("button");
    file.type = "button";
    file.className = "tree-file tree-entry";
    file.textContent = node.name;
    file.dataset.treePath = node.path;
    file.dataset.treeDirectory = "false";
    file.dataset.treeSelected = selectedTreePath === node.path ? "true" : "false";
    li.appendChild(file);
    return li;
  }

  const details = document.createElement("details");
  details.open = node.path === "/workspace" || node.path === "/home/user/.pi/agent";

  const summary = document.createElement("summary");
  summary.className = "tree-dir tree-entry";
  summary.textContent = `${node.name}/`;
  if (node.skipped) summary.textContent += " (skipped)";
  if (node.truncated) summary.textContent += " (truncated)";
  summary.dataset.treePath = node.path;
  summary.dataset.treeDirectory = "true";
  summary.dataset.treeSelected = selectedTreePath === node.path ? "true" : "false";
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

async function refreshFileTree(options: { silent?: boolean } = {}): Promise<void> {
  const { silent = false } = options;
  if (!nodepod) {
    fileTreeEl.textContent = "Boot runtime to load files.";
    updateFileActionState();
    return;
  }

  if (fileTreeRefreshInFlight) return;
  fileTreeRefreshInFlight = true;

  if (!silent && fileTreeEl.childElementCount === 0) {
    fileTreeEl.textContent = "Loading files...";
  }

  const roots = ["/workspace", "/home/user/.pi/agent"];
  const nodes: TreeNode[] = [];

  try {
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
        const root = document.createElement("button");
        root.type = "button";
        root.className = "tree-root tree-entry";
        root.textContent = node.path;
        root.dataset.treePath = node.path;
        root.dataset.treeDirectory = "true";
        root.dataset.treeSelected = selectedTreePath === node.path ? "true" : "false";
        li.appendChild(root);
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

    if (selectedTreePath && !fileTreeEl.querySelector(`[data-tree-path="${CSS.escape(selectedTreePath)}"]`)) {
      setSelectedTreeNode(null, false);
    }

    updateFileActionState();
  } finally {
    fileTreeRefreshInFlight = false;
  }
}

async function uploadFilesToRuntime(files: FileList | null): Promise<void> {
  if (!nodepod || !files || files.length === 0) return;

  const targetDir = selectedTreePath
    ? selectedTreeIsDirectory
      ? selectedTreePath
      : dirname(selectedTreePath)
    : "/workspace";

  setStatus(`Uploading ${files.length} file${files.length > 1 ? "s" : ""}...`, "loading");
  for (const file of Array.from(files)) {
    const fileName = sanitizeUploadName(file.name);
    const targetPath = joinFsPath(targetDir, fileName);
    const bytes = new Uint8Array(await file.arrayBuffer());
    await nodepod.fs.writeFile(targetPath, bytes);
  }

  const firstFileName = sanitizeUploadName(files[0].name);
  setStatus("Upload completed.", "success");
  appendChatMessage("system", `Uploaded ${files.length} file${files.length > 1 ? "s" : ""} to ${targetDir}.`);
  await refreshFileTree({ silent: true });
  setSelectedTreeNode(joinFsPath(targetDir, firstFileName), false);
}

async function downloadSelectedFile(): Promise<void> {
  if (!nodepod || !selectedTreePath || selectedTreeIsDirectory) return;

  try {
    const content = await nodepod.fs.readFile(selectedTreePath);
    const bytes = content instanceof Uint8Array ? content : new TextEncoder().encode(content);
    const blob = new Blob([bytes]);
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = selectedTreePath.split("/").pop() || "download";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    setStatus("Download started.", "success");
    await refreshFileTree({ silent: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    setStatus(`Download failed: ${message}`, "error");
  }
}

async function bootRuntime(): Promise<void> {
  if (nodepod) return;

  setStatus("Booting Nodepod runtime...", "loading");
  setPreviewIdle("Booting preview bridge...");
  installBtn.disabled = true;
  installReady = false;
  updateStartButtonState();

  try {
    const corsProxyUrl = new URL("/__cors_proxy__/", location.origin).toString();
    const bootOptions = {
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
    } as const;

    try {
      nodepod = await Nodepod.boot({
        ...bootOptions,
        swUrl: "/__sw__.js",
        onServerReady: (port, url) => {
          setPreviewTarget(port, url);
        },
      });
      setPreviewIdle("Run a local server in the terminal to open a live preview.");
    } catch (previewErr) {
      const message = previewErr instanceof Error ? previewErr.message : String(previewErr);
      nodepod = await Nodepod.boot(bootOptions);
      setPreviewUnavailable(`Preview unavailable in this session. ${message}`);
      appendChatMessage(
        "system",
        "Preview bridge unavailable. Runtime booted without in-page app preview.",
      );
    }

    agentTerminal = nodepod.createTerminal({ Terminal, FitAddon });
    agentTerminal.attach(agentTerminalEl);
    wireTerminalOutputMirror(agentTerminal);
    agentTerminal.showPrompt();

    workspaceTerminal = nodepod.createTerminal({ Terminal, FitAddon });
    workspaceTerminal.attach(workspaceTerminalEl);
    workspaceTerminal.showPrompt();

    setActiveTerminal("agent");

    applyEnvBtn.disabled = false;
    updateStartButtonState();
    toggleTerminalBtn.disabled = false;
    clearBtn.disabled = false;
    agentTerminalTabBtn.disabled = false;
    workspaceTerminalTabBtn.disabled = false;
    uploadFileBtn.disabled = false;
    updateChatControlsState();
    updateFileActionState();

    await refreshFileTree();
    startFileTreeAutoRefresh();
    setStatus("Runtime booted.", "success");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    setStatus(`Boot failed: ${message}`, "error");
    setPreviewUnavailable(`Preview unavailable because runtime boot failed. ${message}`);
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
  beginAgentReply(prompt);
  sendCommand(prompt);
  cmdInput.value = "";
}

appendChatMessage("system", "LiveNode Agent ready flow: 1) Install Agent  2) Configure Env  3) Start CLI");
appendChatMessage("system", "Use this chat box as the main interaction pane.");
setStatus("Idle", "idle");
setPreviewIdle();
updateTerminalTabState();
renderSessionMeta();
updateStartButtonState();
updateChatControlsState();
updateFileActionState();

fileTreeEl.addEventListener("click", (event) => {
  const target = (event.target as HTMLElement | null)?.closest<HTMLElement>("[data-tree-path]");
  if (!target) return;
  const path = target.dataset.treePath;
  if (!path) return;
  setSelectedTreeNode(path, target.dataset.treeDirectory === "true");
});

uploadFileBtn.addEventListener("click", () => {
  if (!nodepod) {
    setStatus("Boot runtime first.", "idle");
    return;
  }
  fileUploadInput.value = "";
  fileUploadInput.click();
});

fileUploadInput.addEventListener("change", () => {
  void uploadFilesToRuntime(fileUploadInput.files);
});

downloadFileBtn.addEventListener("click", () => {
  void downloadSelectedFile();
});

openPreviewBtn.addEventListener("click", () => {
  if (!activePreview) return;
  window.open(activePreview.url, "_blank", "noopener,noreferrer");
});

agentTerminalTabBtn.addEventListener("click", () => {
  setActiveTerminal("agent");
});

workspaceTerminalTabBtn.addEventListener("click", () => {
  setActiveTerminal("workspace");
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
  setActiveTerminal("agent");

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
  setActiveTerminal("agent");
  pendingStartBuffer = "";
  clearStartWatchdog();
  startWatchdogTimer = window.setTimeout(() => {
    if (!pendingStart) return;
    finishStartError("Agent startup timeout. Retry Start Agent CLI or open terminal.");
  }, 12000);

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
  const terminal = getActiveTerminal();
  if (!terminal) return;
  terminal.clear();
  if (!(terminal as any)._running) {
    terminal.showPrompt();
  }
});
