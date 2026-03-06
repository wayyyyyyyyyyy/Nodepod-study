import { Nodepod, NodepodProcess, NodepodTerminal } from "../src/index";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

const statusEl = document.querySelector("#status") as HTMLSpanElement;
const sessionMetaEl = document.querySelector("#session-meta") as HTMLSpanElement;
const installBtn = document.querySelector("#install-btn") as HTMLButtonElement;
const applyEnvBtn = document.querySelector("#apply-env-btn") as HTMLButtonElement;
const startAgentBtn = document.querySelector("#start-agent-btn") as HTMLButtonElement;
const newSessionBtn = document.querySelector("#new-session-btn") as HTMLButtonElement;
const stopSessionBtn = document.querySelector("#stop-session-btn") as HTMLButtonElement;
const reconnectSessionBtn = document.querySelector("#reconnect-session-btn") as HTMLButtonElement;
const clearConversationBtn = document.querySelector(
  "#clear-conversation-btn",
) as HTMLButtonElement;
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
const PI_AGENT_HOME = "/home/user/.pi/agent";
const PI_AGENT_CLI_PATH =
  "/home/user/.pi/agent/node_modules/@mariozechner/pi-coding-agent/dist/cli.js";
const MAX_TREE_DEPTH = 4;
const MAX_DIR_ITEMS = 80;
const SKIP_RECURSE_DIRS = new Set(["node_modules", ".git"]);
const FILE_TREE_AUTO_REFRESH_MS = 12000;
const AGENT_STREAM_BUFFER_LIMIT = 120000;
const AGENT_RPC_START_TIMEOUT_MS = 12000;

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
  sessionName: string;
  sessionId: string;
  model: string;
  messageCount: number | null;
  pendingMessageCount: number | null;
};

type PreviewState = "idle" | "ready" | "unavailable";

type PreviewTarget = {
  port: number;
  url: string;
};

type TerminalKind = "agent" | "workspace";
type SystemMessageKind = "tool" | "retry" | "error";
type SystemErrorKind = "auth" | "startup" | "rpc" | "tool" | "extension" | "runtime";

type AgentRpcRequest =
  | { id: string; type: "get_state" | "new_session" }
  | { id: string; type: "prompt"; message: string }
  | { id: string; type: "extension_ui_response"; cancelled: true }
  | { id: string; type: "extension_ui_response"; confirmed: boolean }
  | { id: string; type: "extension_ui_response"; value: string };

type AgentRpcResponse = {
  type: "response";
  id: string;
  command?: string;
  success: boolean;
  data?: unknown;
  error?: {
    message?: string;
  };
};

type AgentRpcEvent =
  | { type: "agent_start" }
  | { type: "agent_end"; messages?: any[] }
  | { type: "message_update"; message?: any; assistantMessageEvent?: any }
  | { type: "tool_execution_start"; toolName?: string; args?: Record<string, unknown> }
  | { type: "tool_execution_update"; toolName?: string; partialResult?: any }
  | { type: "tool_execution_end"; toolName?: string; result?: any; isError?: boolean }
  | { type: "auto_retry_start"; attempt?: number; maxAttempts?: number; delayMs?: number; errorMessage?: string }
  | { type: "auto_retry_end"; success?: boolean; attempt?: number; finalError?: string }
  | { type: "extension_ui_request"; id: string; method: string; [key: string]: unknown }
  | { type: "extension_error"; error?: string; extensionPath?: string; event?: string };

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
let pendingReconnect = false;
let startWatchdogTimer: number | null = null;
let awaitingAgentReply = false;
let pendingSessionReset = false;
let selectedTreePath: string | null = null;
let selectedTreeIsDirectory = false;
let fileTreeRefreshInFlight = false;
let fileTreeAutoRefreshTimer: number | null = null;
let previewState: PreviewState = "idle";
let previewMessage = "Run a local server in the terminal to open a live preview.";
let activePreview: PreviewTarget | null = null;
let agentRpcProcess: NodepodProcess | null = null;
let agentRpcStdoutBuffer = "";
let agentRpcRequestSeq = 0;
let agentRpcStartRequestId: string | null = null;
let agentRpcNewSessionRequestId: string | null = null;
let agentRpcCurrentPromptId: string | null = null;
let agentRpcReplyBuffer = "";
let lastKnownSessionFile: string | null = null;
let activeToolMessageEl: HTMLDivElement | null = null;
let activeRetryMessageEl: HTMLDivElement | null = null;
let activeToolArgs: Record<string, unknown> | null = null;
const announcedPreviewPorts = new Set<number>();
const sessionMeta: SessionMeta = {
  cwd: "",
  sessionName: "",
  sessionId: "",
  model: "",
  messageCount: null,
  pendingMessageCount: null,
};

function updateChatControlsState(): void {
  const canChat = agentSessionStarted && !pendingSessionReset;
  const canManageSession = canChat && !awaitingAgentReply && !pendingStart;
  const canReconnect =
    !!appliedConfig &&
    installReady &&
    !pendingStart &&
    !pendingSessionReset &&
    !awaitingAgentReply &&
    !agentSessionStarted &&
    !!lastKnownSessionFile;
  cmdInput.disabled = !canChat;
  runBtn.disabled = !canChat || awaitingAgentReply;
  newSessionBtn.disabled = !canManageSession;
  stopSessionBtn.disabled = !canManageSession;
  reconnectSessionBtn.disabled = !canReconnect;
  clearConversationBtn.disabled = chatLogEl.childElementCount === 0 || awaitingAgentReply;
  renderSessionMeta();
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
      ? "Agent Terminal is reserved for install logs and RPC debug output."
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
  updateChatControlsState();
  return message;
}

function updateChatMessage(message: HTMLDivElement, text: string): void {
  message.textContent = text;
  scrollChatToBottom();
  updateChatControlsState();
}

function setSystemMessageVariant(
  message: HTMLDivElement,
  kind: SystemMessageKind,
  label: string,
): void {
  message.dataset.systemKind = kind;
  message.dataset.systemLabel = label;
}

function appendSystemStatusMessage(
  text: string,
  kind: SystemMessageKind,
  label: string,
): HTMLDivElement {
  const message = appendChatMessage("system", text);
  setSystemMessageVariant(message, kind, label);
  return message;
}

function formatErrorLabel(kind: SystemErrorKind): string {
  switch (kind) {
    case "auth":
      return "Error · Auth";
    case "startup":
      return "Error · Startup";
    case "rpc":
      return "Error · RPC";
    case "tool":
      return "Error · Tool";
    case "extension":
      return "Error · Extension";
    default:
      return "Error · Runtime";
  }
}

function classifyErrorKind(message: string, fallback: SystemErrorKind): SystemErrorKind {
  const normalized = message.toLowerCase();

  if (
    normalized.includes("401") ||
    normalized.includes("authentication") ||
    normalized.includes("invalid auth") ||
    normalized.includes("api key") ||
    normalized.includes("unauthorized") ||
    normalized.includes("expired")
  ) {
    return "auth";
  }

  if (normalized.includes("extension")) {
    return "extension";
  }

  if (
    normalized.includes("startup") ||
    normalized.includes("start agent") ||
    normalized.includes("exited early") ||
    normalized.includes("startup timeout")
  ) {
    return "startup";
  }

  if (
    normalized.includes("rpc") ||
    normalized.includes("process is not running") ||
    normalized.includes("session is not running")
  ) {
    return "rpc";
  }

  return fallback;
}

function appendErrorMessage(message: string, fallback: SystemErrorKind): HTMLDivElement {
  const kind = classifyErrorKind(message, fallback);
  return appendSystemStatusMessage(message, "error", formatErrorLabel(kind));
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

function renderSessionMeta(): void {
  if (!sessionMetaEl) return;
  const parts: string[] = [];

  if (pendingStart) {
    parts.push("rpc:starting");
  } else if (pendingSessionReset) {
    parts.push("rpc:resetting");
  } else if (!agentSessionStarted) {
    parts.push("rpc:offline");
  } else if (awaitingAgentReply) {
    parts.push("rpc:busy");
  } else {
    parts.push("rpc:ready");
  }

  if (sessionMeta.model) parts.push(`model:${sessionMeta.model}`);
  if (sessionMeta.sessionName) parts.push(`name:${sessionMeta.sessionName}`);
  if (sessionMeta.sessionId) parts.push(`id:${sessionMeta.sessionId.slice(0, 8)}`);
  if (typeof sessionMeta.messageCount === "number") parts.push(`msgs:${sessionMeta.messageCount}`);
  if (typeof sessionMeta.pendingMessageCount === "number") {
    parts.push(`pending:${sessionMeta.pendingMessageCount}`);
  }
  if (sessionMeta.cwd) parts.push(`cwd:${sessionMeta.cwd}`);

  sessionMetaEl.textContent = parts.length > 0 ? parts.join(" | ") : "Session info will appear here.";
}

function updateSessionMetaFromState(state: any): void {
  if (!state || typeof state !== "object") return;
  let changed = false;

  const cwd = typeof state.cwd === "string" ? state.cwd : "";
  if (cwd && sessionMeta.cwd !== cwd) {
    sessionMeta.cwd = cwd;
    changed = true;
  }

  const sessionName = typeof state.sessionName === "string" ? state.sessionName : sessionMeta.sessionName;
  if (sessionMeta.sessionName !== sessionName) {
    sessionMeta.sessionName = sessionName;
    changed = true;
  }

  const sessionId = typeof state.sessionId === "string" ? state.sessionId : sessionMeta.sessionId;
  if (sessionMeta.sessionId !== sessionId) {
    sessionMeta.sessionId = sessionId;
    changed = true;
  }

  const model =
    typeof state.modelName === "string"
      ? state.modelName
      : typeof state.model === "string"
        ? state.model
        : typeof state.model?.name === "string"
          ? state.model.name
          : typeof state.model?.id === "string"
            ? state.model.id
            : "";
  if (model && sessionMeta.model !== model) {
    sessionMeta.model = model;
    changed = true;
  }

  const messageCount =
    typeof state.messageCount === "number" && Number.isFinite(state.messageCount)
      ? state.messageCount
      : sessionMeta.messageCount;
  if (sessionMeta.messageCount !== messageCount) {
    sessionMeta.messageCount = messageCount;
    changed = true;
  }

  const pendingMessageCount =
    typeof state.pendingMessageCount === "number" && Number.isFinite(state.pendingMessageCount)
      ? state.pendingMessageCount
      : sessionMeta.pendingMessageCount;
  if (sessionMeta.pendingMessageCount !== pendingMessageCount) {
    sessionMeta.pendingMessageCount = pendingMessageCount;
    changed = true;
  }

  const sessionFile = typeof state.sessionFile === "string" ? state.sessionFile : "";
  if (sessionFile) {
    lastKnownSessionFile = sessionFile;
  }

  if (changed) renderSessionMeta();
}

function resetAgentStreamState(): void {
  awaitingAgentReply = false;
  agentRpcCurrentPromptId = null;
  agentRpcReplyBuffer = "";
  activeToolMessageEl = null;
  activeRetryMessageEl = null;
  activeToolArgs = null;
  updateChatControlsState();
}

function summarizeToolArgs(args: Record<string, unknown> | undefined): string {
  if (!args || typeof args !== "object") return "";

  const keys = ["filePath", "path", "newPath", "command", "cmd", "pattern"];
  for (const key of keys) {
    const value = args[key];
    if (typeof value === "string" && value.trim()) {
      const compact = value.replace(/\s+/g, " ").trim();
      return compact.length > 72 ? `${compact.slice(0, 69)}...` : compact;
    }
  }

  if (Array.isArray(args.paths) && args.paths.length > 0) {
    const first = args.paths.find((value) => typeof value === "string");
    if (typeof first === "string") return first;
  }

  return "";
}

function truncateInlineText(value: string, maxLength = 120): string {
  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length <= maxLength) return compact;
  return `${compact.slice(0, Math.max(0, maxLength - 3))}...`;
}

function getRecordString(value: unknown, keys: string[]): string {
  if (!value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  for (const key of keys) {
    const candidate = record[key];
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate;
    }
  }
  return "";
}

function getRecordNumber(value: unknown, keys: string[]): number | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  for (const key of keys) {
    const candidate = record[key];
    if (typeof candidate === "number" && Number.isFinite(candidate)) {
      return candidate;
    }
  }
  return null;
}

function getRecordArrayLength(value: unknown, keys: string[]): number | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  for (const key of keys) {
    const candidate = record[key];
    if (Array.isArray(candidate)) {
      return candidate.length;
    }
  }
  return null;
}

function countTextLines(value: string): number {
  if (!value) return 0;
  return value.split(/\r?\n/).length;
}

function summarizeToolSuccess(
  toolName: string,
  args: Record<string, unknown> | undefined,
  result: unknown,
): string {
  const normalized = toolName.toLowerCase();
  const detail = summarizeToolArgs(args);
  const path =
    detail || getRecordString(result, ["filePath", "path", "newPath", "targetPath", "outputPath"]);

  if (normalized === "read") {
    const content = getRecordString(result, ["content", "text", "output"]);
    if (path && content) {
      return `Read ${path} (${countTextLines(content)} lines).`;
    }
    if (path) return `Read ${path}.`;
    return "Read completed.";
  }

  if (normalized === "write") {
    const content = getRecordString(result, ["content", "text"]);
    if (path && content) {
      return `Wrote ${path} (${content.length} chars).`;
    }
    if (path) return `Wrote ${path}.`;
    return "Write completed.";
  }

  if (normalized === "edit") {
    const changes =
      getRecordNumber(result, ["changeCount", "editCount", "replacementCount", "modifiedLineCount"]) ??
      getRecordArrayLength(result, ["changes", "edits", "replacements"]);
    if (path && typeof changes === "number") {
      return `Edited ${path} (${changes} changes).`;
    }
    if (path) return `Edited ${path}.`;
    return "Edit completed.";
  }

  if (normalized === "bash") {
    const command = detail || getRecordString(result, ["command", "cmd"]);
    const exitCode = getRecordNumber(result, ["exitCode", "code", "status"]);
    const excerpt = truncateInlineText(
      getRecordString(result, ["stderr", "stdout", "output", "message"]),
      100,
    );
    const commandLabel = command ? `: ${truncateInlineText(command, 72)}` : "";
    const exitLabel = typeof exitCode === "number" ? ` (exit ${exitCode})` : "";
    if (excerpt) {
      return `bash completed${commandLabel}${exitLabel}. ${excerpt}`;
    }
    return `bash completed${commandLabel}${exitLabel}.`;
  }

  if (normalized === "search" || normalized === "find" || normalized === "grep") {
    const matches =
      getRecordNumber(result, ["matchCount", "count", "totalMatches"]) ??
      getRecordArrayLength(result, ["matches", "results", "files"]);
    if (detail && typeof matches === "number") {
      return `${toolName} found ${matches} matches for ${detail}.`;
    }
    if (typeof matches === "number") {
      return `${toolName} found ${matches} matches.`;
    }
  }

  const message = getRecordString(result, ["message", "summary"]);
  if (message) {
    return `${toolName} completed. ${truncateInlineText(message, 100)}`;
  }

  if (detail) {
    return `${toolName} completed: ${truncateInlineText(detail, 88)}.`;
  }

  return `${toolName} completed.`;
}

function summarizeToolFailure(
  toolName: string,
  args: Record<string, unknown> | undefined,
  result: unknown,
): string {
  const detail = summarizeToolArgs(args);
  const message = truncateInlineText(
    getRecordString(result, ["error", "message", "stderr", "output"]),
    120,
  );

  if (message && detail) {
    return `${toolName} failed for ${truncateInlineText(detail, 72)}. ${message}`;
  }
  if (message) {
    return `${toolName} failed. ${message}`;
  }
  if (detail) {
    return `${toolName} failed for ${truncateInlineText(detail, 72)}.`;
  }
  return `${toolName} reported an error.`;
}

function formatToolLabel(toolName: string): string {
  return `Tool · ${toolName}`;
}

function setToolActivityMessage(text: string, toolName = "tool"): void {
  const label = formatToolLabel(toolName);
  if (!activeToolMessageEl) {
    activeToolMessageEl = appendSystemStatusMessage(text, "tool", label);
    return;
  }
  setSystemMessageVariant(activeToolMessageEl, "tool", label);
  updateChatMessage(activeToolMessageEl, text);
}

function closeToolActivityMessage(text: string, toolName = "tool"): void {
  const label = formatToolLabel(toolName);
  if (!activeToolMessageEl) {
    appendSystemStatusMessage(text, "tool", label);
    return;
  }
  setSystemMessageVariant(activeToolMessageEl, "tool", label);
  updateChatMessage(activeToolMessageEl, text);
  activeToolMessageEl = null;
}

function closeToolErrorMessage(text: string): void {
  if (!activeToolMessageEl) {
    appendErrorMessage(text, "tool");
    return;
  }
  setSystemMessageVariant(activeToolMessageEl, "error", formatErrorLabel("tool"));
  updateChatMessage(activeToolMessageEl, text);
  activeToolMessageEl = null;
}

function setRetryActivityMessage(text: string): void {
  if (!activeRetryMessageEl) {
    activeRetryMessageEl = appendSystemStatusMessage(text, "retry", "Retry");
    return;
  }
  setSystemMessageVariant(activeRetryMessageEl, "retry", "Retry");
  updateChatMessage(activeRetryMessageEl, text);
}

function closeRetryActivityMessage(text: string): void {
  if (!activeRetryMessageEl) {
    appendSystemStatusMessage(text, "retry", "Retry");
    return;
  }
  setSystemMessageVariant(activeRetryMessageEl, "retry", "Retry");
  updateChatMessage(activeRetryMessageEl, text);
  activeRetryMessageEl = null;
}

function nextAgentRpcId(prefix: string): string {
  agentRpcRequestSeq += 1;
  return `${prefix}-${agentRpcRequestSeq}`;
}

function writeAgentTerminalLog(text: string): void {
  if (!text || !agentTerminal) return;
  agentTerminal.write(text.replace(/\n/g, "\r\n"));
}

function stopAgentRpcProcess(resetSession = true): void {
  if (agentRpcProcess && !agentRpcProcess.exited) {
    agentRpcProcess.kill();
  }
  agentRpcProcess = null;
  agentRpcStdoutBuffer = "";
  agentRpcStartRequestId = null;
  agentRpcNewSessionRequestId = null;
  pendingReconnect = false;
  pendingSessionReset = false;
  resetAgentStreamState();

  if (resetSession) {
    agentSessionStarted = false;
    sessionMeta.cwd = "";
    sessionMeta.sessionName = "";
    sessionMeta.sessionId = "";
    sessionMeta.model = "";
    sessionMeta.messageCount = null;
    sessionMeta.pendingMessageCount = null;
    renderSessionMeta();
  }
}

function beginSessionReset(): void {
  if (!agentRpcProcess || agentRpcProcess.exited) {
    setStatus("Agent session is not running.", "error");
    return;
  }

  pendingSessionReset = true;
  updateChatControlsState();
  setStatus("Starting a fresh agent session...", "loading");

  try {
    agentRpcNewSessionRequestId = nextAgentRpcId("new-session");
    sendAgentRpcRequest({
      id: agentRpcNewSessionRequestId,
      type: "new_session",
    });
  } catch (err) {
    pendingSessionReset = false;
    agentRpcNewSessionRequestId = null;
    updateChatControlsState();
    const message = err instanceof Error ? err.message : String(err);
    appendErrorMessage(message, "rpc");
    setStatus(message, "error");
  }
}

function buildAgentRpcEnv(config: AgentConfig): Record<string, string> {
  return {
    HOME: "/home/user",
    NODEPOD_NO_INTERACTIVE_TIMEOUT: "1",
    PI_API_KEY: config.apiKey,
    PI_BASE_URL: config.baseUrl,
    PI_MODEL_ID: config.modelId,
  };
}

function buildAgentRpcArgs(config: AgentConfig, sessionFile?: string | null): string[] {
  const args = [
    PI_AGENT_CLI_PATH,
    "--mode",
    "rpc",
    "--provider",
    "custom-openai",
    "--model",
    config.modelId,
  ];
  if (sessionFile) {
    args.push("--session", sessionFile);
  }
  return args;
}

function sendAgentRpcRequest(request: AgentRpcRequest): void {
  if (!agentRpcProcess || agentRpcProcess.exited) {
    throw new Error("Agent RPC process is not running.");
  }
  agentRpcProcess.write(`${JSON.stringify(request)}\n`);
}

function finalizeAgentReply(messages?: any[]): void {
  const fromEvents = agentRpcReplyBuffer.trim();
  let finalText = fromEvents;
  if (!finalText && Array.isArray(messages)) {
    finalText = messages
      .filter((message) => message?.role === "assistant")
      .flatMap((message) => (Array.isArray(message?.content) ? message.content : []))
      .map((item) => (item?.type === "text" && typeof item.text === "string" ? item.text : ""))
      .join("")
      .trim();
  }

  resetAgentStreamState();
  if (finalText) {
    appendChatMessage("agent", finalText);
  } else {
    appendSystemStatusMessage("Agent finished without a text reply.", "retry", "Reply");
  }
  setStatus("Agent ready.", "success");
}

function respondToUnsupportedDialog(event: Extract<AgentRpcEvent, { type: "extension_ui_request" }>): void {
  if (event.method === "notify" && typeof event.message === "string") {
    appendChatMessage("system", event.message);
    return;
  }

  if (event.method === "setStatus" && typeof event.statusText === "string") {
    setStatus(event.statusText, "loading");
    return;
  }

  if (!["select", "confirm", "input", "editor"].includes(event.method)) {
    appendChatMessage("system", `Ignored extension UI request: ${event.method}`);
    return;
  }

  appendChatMessage("system", `Unsupported extension dialog: ${event.method}`);
  try {
    sendAgentRpcRequest({
      id: String(event.id),
      type: "extension_ui_response",
      cancelled: true,
    });
  } catch {
    // Process is already gone; nothing left to do.
  }
}

function handleAgentRpcEvent(event: AgentRpcEvent): void {
  switch (event.type) {
    case "agent_start":
      if (awaitingAgentReply) {
        setStatus("Agent is thinking...", "loading");
      }
      break;
    case "message_update":
      if (!awaitingAgentReply) break;
      if (event.assistantMessageEvent?.type === "text_delta") {
        const delta = String(event.assistantMessageEvent.delta ?? "");
        if (delta) {
          agentRpcReplyBuffer += delta;
          if (agentRpcReplyBuffer.length > AGENT_STREAM_BUFFER_LIMIT) {
            agentRpcReplyBuffer = agentRpcReplyBuffer.slice(-AGENT_STREAM_BUFFER_LIMIT);
          }
        }
      }
      break;
    case "tool_execution_start":
      if (awaitingAgentReply) {
        const toolName = typeof event.toolName === "string" ? event.toolName : "tool";
        activeToolArgs = event.args ?? null;
        const detail = summarizeToolArgs(event.args);
        setToolActivityMessage(
          detail ? `Running ${toolName}: ${detail}` : `Running ${toolName}...`,
          toolName,
        );
        setStatus(`Running ${toolName}...`, "loading");
      }
      break;
    case "tool_execution_end":
      if (awaitingAgentReply) {
        const toolName = typeof event.toolName === "string" ? event.toolName : "tool";
        if (event.isError) {
          const summary = summarizeToolFailure(toolName, activeToolArgs ?? undefined, event.result);
          closeToolErrorMessage(summary);
          setStatus(summary, "error");
        } else {
          closeToolActivityMessage(
            summarizeToolSuccess(toolName, activeToolArgs ?? undefined, event.result),
            toolName,
          );
        }
        activeToolArgs = null;
      }
      break;
    case "auto_retry_start":
      if (awaitingAgentReply) {
        const attempt = typeof event.attempt === "number" ? event.attempt : "?";
        const maxAttempts = typeof event.maxAttempts === "number" ? event.maxAttempts : "?";
        setRetryActivityMessage(`Retrying request (${attempt}/${maxAttempts})...`);
        setStatus(`Retrying agent request (${attempt}/${maxAttempts})...`, "loading");
      }
      break;
    case "auto_retry_end":
      if (awaitingAgentReply) {
        if (event.success === false && typeof event.finalError === "string") {
          closeRetryActivityMessage(`Retry failed: ${event.finalError}`);
          setStatus(`Retry failed: ${event.finalError}`, "error");
        } else {
          closeRetryActivityMessage("Retry completed.");
        }
      }
      break;
    case "extension_ui_request":
      respondToUnsupportedDialog(event);
      break;
    case "extension_error":
      if (typeof event.error === "string") {
        appendErrorMessage(`Extension error: ${event.error}`, "extension");
      }
      break;
    case "agent_end":
      if (awaitingAgentReply) {
        finalizeAgentReply(event.messages);
      }
      try {
        sendAgentRpcRequest({ id: nextAgentRpcId("get-state"), type: "get_state" });
      } catch {
        /* process exited */
      }
      break;
    default:
      break;
  }
}

function handleAgentRpcResponse(response: AgentRpcResponse): void {
  if (response.id === agentRpcStartRequestId) {
    if (response.success) {
      updateSessionMetaFromState(response.data);
      finishStartSuccess();
      if (pendingReconnect) {
        setStatus("Agent session reconnected.", "success");
        appendChatMessage("system", "Reconnected to the previous agent session.");
      } else {
        setStatus("Agent RPC session started.", "success");
        appendChatMessage("system", "Agent session started in structured RPC mode.");
      }
    } else {
      const message = response.error?.message || "Agent CLI start failed.";
      finishStartError(message);
    }
    agentRpcStartRequestId = null;
    return;
  }

  if (response.id === agentRpcNewSessionRequestId || response.command === "new_session") {
    pendingSessionReset = false;
    agentRpcNewSessionRequestId = null;
    updateChatControlsState();

    if (!response.success) {
      const message = response.error?.message || "Failed to start a new agent session.";
      appendErrorMessage(message, "rpc");
      setStatus(message, "error");
      return;
    }

    const cancelled =
      !!response.data &&
      typeof response.data === "object" &&
      "cancelled" in response.data &&
      Boolean((response.data as { cancelled?: unknown }).cancelled);

    if (cancelled) {
      appendChatMessage("system", "New session request was cancelled.");
      setStatus("New session was cancelled.", "idle");
      return;
    }

    resetAgentStreamState();
    appendChatMessage("system", "Started a new agent session.");
    setStatus("New agent session started.", "success");
    try {
      sendAgentRpcRequest({ id: nextAgentRpcId("get-state"), type: "get_state" });
    } catch {
      /* process exited */
    }
    return;
  }

  if (response.command === "get_state" || response.id.startsWith("get-state")) {
    if (response.success) {
      updateSessionMetaFromState(response.data);
    }
    return;
  }

  if (response.command === "prompt" || response.id === agentRpcCurrentPromptId) {
    if (!response.success) {
      const message = response.error?.message || "Agent request failed.";
      resetAgentStreamState();
      appendErrorMessage(message, "rpc");
      setStatus(message, "error");
    }
  }
}

function handleAgentRpcPayload(payload: AgentRpcResponse | AgentRpcEvent): void {
  if (payload.type === "response") {
    handleAgentRpcResponse(payload);
    return;
  }

  handleAgentRpcEvent(payload);
}

function isAgentRpcPayload(value: any): value is AgentRpcResponse | AgentRpcEvent {
  if (!value || typeof value !== "object") return false;
  if (value.type === "response") return true;
  return [
    "agent_start",
    "agent_end",
    "message_update",
    "tool_execution_start",
    "tool_execution_update",
    "tool_execution_end",
    "auto_retry_start",
    "auto_retry_end",
    "extension_ui_request",
    "extension_error",
  ].includes(String(value.type));
}

function findNextAgentRpcPacket(
  buffer: string,
): { payload: AgentRpcResponse | AgentRpcEvent; start: number; end: number } | null {
  for (let start = buffer.indexOf("{"); start !== -1; start = buffer.indexOf("{", start + 1)) {
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let index = start; index < buffer.length; index += 1) {
      const ch = buffer[index];

      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (ch === "\\") {
          escaped = true;
        } else if (ch === "\"") {
          inString = false;
        }
        continue;
      }

      if (ch === "\"") {
        inString = true;
        continue;
      }

      if (ch === "{") {
        depth += 1;
        continue;
      }

      if (ch !== "}") continue;

      depth -= 1;
      if (depth !== 0) continue;

      const candidate = buffer.slice(start, index + 1);
      try {
        const parsed = JSON.parse(candidate);
        if (isAgentRpcPayload(parsed)) {
          return { payload: parsed, start, end: index + 1 };
        }
      } catch {
        // Ignore malformed candidate and keep scanning.
      }
      break;
    }
  }
  return null;
}

function trimAgentRpcBuffer(): void {
  if (agentRpcStdoutBuffer.length <= AGENT_STREAM_BUFFER_LIMIT * 2) return;
  const lastBrace = agentRpcStdoutBuffer.lastIndexOf("{");
  if (lastBrace !== -1) {
    agentRpcStdoutBuffer = agentRpcStdoutBuffer.slice(lastBrace);
    return;
  }
  agentRpcStdoutBuffer = agentRpcStdoutBuffer.slice(-AGENT_STREAM_BUFFER_LIMIT);
}

function handleAgentRpcStdout(chunk: string): void {
  if (!chunk) return;
  agentRpcStdoutBuffer += chunk.replace(/\r\n/g, "\n");
  trimAgentRpcBuffer();

  let packet = findNextAgentRpcPacket(agentRpcStdoutBuffer);
  while (packet) {
    agentRpcStdoutBuffer = agentRpcStdoutBuffer.slice(packet.end);
    handleAgentRpcPayload(packet.payload);
    packet = findNextAgentRpcPacket(agentRpcStdoutBuffer);
  }
}

function queueAgentPrompt(prompt: string): void {
  if (!agentRpcProcess || agentRpcProcess.exited) {
    setStatus("Agent session is not running.", "error");
    return;
  }
  awaitingAgentReply = true;
  agentRpcReplyBuffer = "";
  agentRpcCurrentPromptId = nextAgentRpcId("prompt");
  updateChatControlsState();
  setStatus("Agent is thinking...", "loading");
  try {
    sendAgentRpcRequest({
      id: agentRpcCurrentPromptId,
      type: "prompt",
      message: prompt,
    });
  } catch (err) {
    resetAgentStreamState();
    const message = err instanceof Error ? err.message : String(err);
    appendErrorMessage(message, "rpc");
    setStatus(message, "error");
  }
}

async function startAgentRpcSession(
  config: AgentConfig,
  sessionFile: string | null = null,
): Promise<void> {
  if (!nodepod) throw new Error("Nodepod runtime is not ready.");

  stopAgentRpcProcess(false);
  pendingStart = true;
  resetAgentStreamState();
  updateStartButtonState();
  clearStartWatchdog();
  setStatus("Starting Agent RPC session...", "loading");

  const proc = await nodepod.spawn("node", buildAgentRpcArgs(config, sessionFile), {
    cwd: "/workspace",
    env: buildAgentRpcEnv(config),
  });
  agentRpcProcess = proc;

  proc.on("output", (chunk: string) => {
    if (agentRpcProcess !== proc) return;
    handleAgentRpcStdout(chunk);
  });
  proc.on("error", (chunk: string) => {
    if (agentRpcProcess !== proc) return;
    const message = String(chunk ?? "");
    if (!message) return;
    writeAgentTerminalLog(message);
  });
  proc.on("exit", (code: number) => {
    const wasCurrent = agentRpcProcess === proc;
    const exitedDuringStart = wasCurrent && pendingStart;
    const exitedDuringReply = wasCurrent && awaitingAgentReply;
    if (wasCurrent) {
      stopAgentRpcProcess();
    }
    if (exitedDuringStart) {
      finishStartError(`Agent process exited early (code ${code}).`);
      return;
    }
    if (exitedDuringReply) {
      appendErrorMessage(`Agent process exited unexpectedly (code ${code}).`, "rpc");
    }
    if (wasCurrent) {
      setStatus(`Agent process stopped (exit ${code}).`, code === 0 ? "idle" : "error");
    }
  });

  agentRpcStartRequestId = nextAgentRpcId("get-state");
  startWatchdogTimer = window.setTimeout(() => {
    if (!pendingStart) return;
    finishStartError("Agent startup timeout. Retry Start Agent CLI or open terminal.");
    stopAgentRpcProcess();
  }, AGENT_RPC_START_TIMEOUT_MS);

  sendAgentRpcRequest({
    id: agentRpcStartRequestId,
    type: "get_state",
  });
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
  pendingReconnect = false;
  clearStartWatchdog();
  updateStartButtonState();
  agentSessionStarted = true;
  resetAgentStreamState();
  updateChatControlsState();
}

function finishStartError(message: string): void {
  pendingStart = false;
  pendingReconnect = false;
  clearStartWatchdog();
  updateStartButtonState();
  agentSessionStarted = false;
  resetAgentStreamState();
  updateChatControlsState();
  setStatus(message, "error");
  appendErrorMessage(message, "startup");
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

    agentTerminal = nodepod.createTerminal({
      Terminal,
      FitAddon,
      shareRuntimeCwd: false,
    });
    agentTerminal.attach(agentTerminalEl);
    agentTerminal.showPrompt();

    workspaceTerminal = nodepod.createTerminal({
      Terminal,
      FitAddon,
      shareRuntimeCwd: false,
    });
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
  queueAgentPrompt(prompt);
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

startAgentBtn.addEventListener("click", async () => {
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

  setActiveTerminal("agent");
  try {
    await startAgentRpcSession(appliedConfig);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    finishStartError(message);
    stopAgentRpcProcess();
  }
});

newSessionBtn.addEventListener("click", () => {
  if (!agentSessionStarted) {
    setStatus("Start Agent CLI first.", "idle");
    return;
  }
  if (awaitingAgentReply || pendingSessionReset) {
    return;
  }
  beginSessionReset();
});

stopSessionBtn.addEventListener("click", () => {
  if (!agentSessionStarted || !agentRpcProcess || agentRpcProcess.exited) {
    setStatus("Agent session is not running.", "idle");
    return;
  }

  stopAgentRpcProcess(false);
  agentSessionStarted = false;
  updateChatControlsState();
  setStatus("Agent session stopped.", "success");
  appendChatMessage(
    "system",
    lastKnownSessionFile
      ? "Agent session stopped. Use Reconnect to reopen the last session."
      : "Agent session stopped.",
  );
});

reconnectSessionBtn.addEventListener("click", async () => {
  if (!appliedConfig) {
    setStatus("Apply Agent Env first.", "idle");
    return;
  }
  if (!installReady) {
    setStatus("Install must complete before reconnecting.", "idle");
    return;
  }
  if (!lastKnownSessionFile) {
    setStatus("No previous session is available to reconnect.", "idle");
    return;
  }
  if (agentSessionStarted || pendingStart || pendingSessionReset || awaitingAgentReply) {
    return;
  }

  syncRuntimeEnv(appliedConfig);
  setActiveTerminal("agent");
  pendingReconnect = true;
  try {
    await startAgentRpcSession(appliedConfig, lastKnownSessionFile);
  } catch (err) {
    pendingReconnect = false;
    const message = err instanceof Error ? err.message : String(err);
    finishStartError(message);
    stopAgentRpcProcess(false);
  }
});

clearConversationBtn.addEventListener("click", () => {
  if (awaitingAgentReply) return;
  chatLogEl.innerHTML = "";
  updateChatControlsState();
  setStatus("Conversation view cleared. Agent session history is unchanged.", "success");
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

window.addEventListener("beforeunload", () => {
  stopAgentRpcProcess(false);
});
