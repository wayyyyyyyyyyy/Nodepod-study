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

export const WORKSPACE_AGENT_APPEND_SYSTEM_MARKDOWN = [
  "## LiveNode Workspace Tools",
  "- Use bash for short-lived validation commands such as tests, builds, lint, and one-off scripts.",
  "- Use workspace tools only for long-running commands such as vite dev servers, watch mode, or other services that should keep running.",
  "- You may output at most one workspace directive block per reply, optionally after a normal user-facing explanation.",
  "",
  "Directive formats:",
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
