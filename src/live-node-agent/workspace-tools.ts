export type WorkspaceDirectiveAction = "run" | "status" | "stop";

export type WorkspaceDirective = {
  action: WorkspaceDirectiveAction;
  command?: string;
};

export type WorkspaceJobStatus =
  | "starting"
  | "running"
  | "ready"
  | "stopped"
  | "failed"
  | "exited";

export type WorkspaceJobSnapshot = {
  id: string;
  command: string;
  cwd: string;
  status: WorkspaceJobStatus;
  port?: number | null;
  exitCode?: number | null;
  lastOutput?: string;
  lastError?: string;
};

export const WORKSPACE_NODE_SKILL_NAME = "workspace-node";
export const WORKSPACE_NODE_SKILL_COMMAND = `/skill:${WORKSPACE_NODE_SKILL_NAME}`;
export const WORKSPACE_NODE_SKILL_DIRECTORY = `/workspace/.pi/agent/skills/${WORKSPACE_NODE_SKILL_NAME}`;
export const WORKSPACE_NODE_SKILL_RUNTIME_PATH =
  `${WORKSPACE_NODE_SKILL_DIRECTORY}/SKILL.md`;

export const WORKSPACE_AGENT_APPEND_SYSTEM_MARKDOWN = [
  "## LiveNode Workspace",
  "",
  "- You are operating inside the Nodepod browser runtime.",
  "- This is not a complete Linux environment.",
  "- The primary project root is `/workspace`.",
  "- Treat `/workspace` as the default working directory for project files unless tool output says otherwise.",
  "- Node.js and common Node package tools are available in the runtime.",
  "- Do not assume Python, apt, gcc, docker, or arbitrary system binaries are installed. Verify specific tool availability from actual command results.",
  "- Do not describe the environment to the user as a complete Linux system.",
  `- A project skill named \`${WORKSPACE_NODE_SKILL_COMMAND}\` is available for more detailed Node.js workspace workflows when needed.`,
  "- Use bash for short-lived validation commands such as tests, builds, lint, directory inspection, and one-off scripts.",
  "- Use workspace tools only for long-running commands such as Vite dev servers, watch mode, or other services that should keep running.",
  "- You may output at most one workspace directive block per reply, optionally after a normal user-facing explanation.",
  "",
  "Directive formats:",
  "",
  "```workspace_run",
  "npm run dev",
  "```",
  "",
  "```workspace_status",
  "```",
  "",
  "```workspace_stop",
  "```",
  "",
  "- Do not ask the user to manually start long-running services if a workspace directive is appropriate.",
  "- After the app returns a workspace tool result, continue the conversation based on that result.",
].join("\n");

export const WORKSPACE_NODE_SKILL_MARKDOWN = [
  "---",
  `name: ${WORKSPACE_NODE_SKILL_NAME}`,
  "description: Use this when a request involves a Node.js project in /workspace and you need to choose between short-lived checks and long-running workspace services.",
  "---",
  "",
  "# Workspace Node",
  "",
  "Apply this skill for Node.js project tasks inside `/workspace`, such as inspecting files, installing packages, running tests, building, starting a local server, or diagnosing startup failures.",
  "",
  "## Core Rules",
  "",
  "- Treat `/workspace` as the default project root unless tool output shows a nested app directory.",
  "- This runtime is not a complete Linux machine. Do not assume Python, apt, gcc, docker, or arbitrary system binaries exist.",
  "- For short-lived project commands that should finish and return output quickly, use `bash` and rely on the exact stdout, stderr, and exit code.",
  "- For long-running project commands that keep a service alive, use a workspace directive instead of waiting on bash to exit.",
  "- Read `package.json` or relevant config files before guessing a start command when the project entrypoint is unclear.",
  "- Diagnose project config, missing files, bad scripts, and port conflicts before concluding Node or bash is unavailable.",
  "- Emit at most one workspace directive block per reply.",
  "",
  "## Short-Lived Command Examples",
  "",
  "- `ls`",
  "- `pwd`",
  "- `cat package.json`",
  "- `npm install`",
  "- `npm test`",
  "- `npm run build`",
  "- `node -v`",
  "",
  "## Long-Running Command Examples",
  "",
  "- `npm start`",
  "- `npm run dev`",
  "- `vite`",
  "- `next dev`",
  "- `pnpm dev`",
  "- watch mode or any local server that should stay running",
  "",
  "## Workspace Directives",
  "",
  "Use these exact directive formats for long-running services:",
  "",
  "```workspace_run",
  "npm run dev",
  "```",
  "",
  "```workspace_status",
  "```",
  "",
  "```workspace_stop",
  "```",
  "",
  "After the app returns a workspace tool result, continue from that result instead of repeating the same directive immediately.",
].join("\n");

export function prepareWorkspaceNodeSkillPrompt(
  prompt: string,
  options: {
    mode?: "user" | "workspace-tool";
    alreadyPrimed?: boolean;
  } = {},
): { prompt: string; usedSkill: boolean } {
  const trimmed = prompt.trim();
  if (!trimmed) {
    return { prompt, usedSkill: false };
  }
  if (options.mode === "workspace-tool" || options.alreadyPrimed) {
    return { prompt, usedSkill: false };
  }
  if (trimmed.startsWith("/")) {
    return {
      prompt,
      usedSkill: trimmed.includes(WORKSPACE_NODE_SKILL_COMMAND),
    };
  }

  return {
    prompt: `${WORKSPACE_NODE_SKILL_COMMAND}\n\n${prompt}`,
    usedSkill: true,
  };
}

const WORKSPACE_DIRECTIVE_PATTERN = /```workspace_(run|status|stop)\s*\n?([\s\S]*?)```/g;

export function extractWorkspaceDirective(text: string): {
  cleanText: string;
  directive: WorkspaceDirective | null;
  hasMultiple: boolean;
} {
  const matches = Array.from(text.matchAll(WORKSPACE_DIRECTIVE_PATTERN));
  if (matches.length === 0) {
    return {
      cleanText: text.trim(),
      directive: null,
      hasMultiple: false,
    };
  }

  const first = matches[0];
  const action = first[1] as WorkspaceDirectiveAction;
  const body = (first[2] ?? "").trim();
  const cleanText = text.replace(WORKSPACE_DIRECTIVE_PATTERN, "").trim();

  if (action === "run") {
    return {
      cleanText,
      directive: body ? { action, command: body } : null,
      hasMultiple: matches.length > 1,
    };
  }

  return {
    cleanText,
    directive: { action },
    hasMultiple: matches.length > 1,
  };
}

export function isWorkspaceJobActive(status: WorkspaceJobStatus): boolean {
  return status === "starting" || status === "running" || status === "ready";
}

export function truncateWorkspaceText(value: string, maxLength = 140): string {
  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length <= maxLength) return compact;
  return `${compact.slice(0, Math.max(0, maxLength - 3))}...`;
}

export function truncateWorkspaceOutputTail(value: string, maxLength = 320): string {
  const normalized = value.replace(/\r\n/g, "\n").trim();
  if (!normalized) return "";
  if (normalized.length <= maxLength) return normalized;
  return `...${normalized.slice(-(maxLength - 3))}`;
}

export function summarizeWorkspaceJob(snapshot: WorkspaceJobSnapshot | null): string {
  if (!snapshot) {
    return "No managed workspace job is active.";
  }

  const parts = [
    `job=${snapshot.id}`,
    `status=${snapshot.status}`,
    `cwd=${snapshot.cwd}`,
    `command=${truncateWorkspaceText(snapshot.command, 72)}`,
  ];

  if (typeof snapshot.port === "number") {
    parts.push(`port=${snapshot.port}`);
  }
  if (typeof snapshot.exitCode === "number") {
    parts.push(`exit=${snapshot.exitCode}`);
  }
  if (snapshot.lastError) {
    parts.push(`error=${truncateWorkspaceText(snapshot.lastError, 90)}`);
  } else if (snapshot.lastOutput) {
    parts.push(`output=${truncateWorkspaceText(snapshot.lastOutput, 90)}`);
  }

  return parts.join(" | ");
}

export function buildWorkspaceJobDiagnostics(snapshot: WorkspaceJobSnapshot | null): string {
  if (!snapshot) {
    return "";
  }

  const lines = [`cwd=${snapshot.cwd}`, `command=${snapshot.command}`];

  if (typeof snapshot.port === "number") {
    lines.push(`port=${snapshot.port}`);
  }
  if (typeof snapshot.exitCode === "number") {
    lines.push(`exit_code=${snapshot.exitCode}`);
  }
  if (snapshot.lastError) {
    lines.push(`stderr_tail=${truncateWorkspaceOutputTail(snapshot.lastError)}`);
  }
  if (snapshot.lastOutput) {
    lines.push(`stdout_tail=${truncateWorkspaceOutputTail(snapshot.lastOutput)}`);
  }
  if (snapshot.status === "failed") {
    lines.push(
      "interpretation=The workspace runtime started the command successfully. Diagnose the command, project config, missing files, or port conflicts before concluding bash/node is unavailable.",
    );
  }

  return lines.join("\n");
}

export function buildWorkspaceDirectiveFollowUp(
  directive: WorkspaceDirective,
  snapshot: WorkspaceJobSnapshot | null,
  note: string,
): string {
  const lines = [
    "Workspace tool result:",
    `action=${directive.action}`,
    `note=${note}`,
    `state=${summarizeWorkspaceJob(snapshot)}`,
  ];

  const diagnostics = buildWorkspaceJobDiagnostics(snapshot);
  if (diagnostics) {
    lines.push("diagnostics:");
    lines.push(diagnostics);
  }

  lines.push(
    "Use this result in your next reply to the user.",
    "Do not emit another workspace_* directive unless you need a different workspace action or the current state is insufficient.",
  );

  return lines.join("\n");
}
