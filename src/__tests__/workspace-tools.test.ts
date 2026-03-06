import { describe, expect, it } from "vitest";
import {
  buildWorkspaceJobDiagnostics,
  buildWorkspaceDirectiveFollowUp,
  extractWorkspaceDirective,
  isWorkspaceJobActive,
  prepareWorkspaceNodeSkillPrompt,
  summarizeWorkspaceJob,
  truncateWorkspaceOutputTail,
  WORKSPACE_AGENT_APPEND_SYSTEM_MARKDOWN,
  WORKSPACE_NODE_SKILL_COMMAND,
  WORKSPACE_NODE_SKILL_MARKDOWN,
} from "../live-node-agent/workspace-tools";

describe("workspace-tools", () => {
  it("extracts a workspace_run directive and strips it from visible text", () => {
    const result = extractWorkspaceDirective(
      "I will start the dev server.\n\n```workspace_run\nnpm run dev\n```",
    );

    expect(result.cleanText).toBe("I will start the dev server.");
    expect(result.directive).toEqual({
      action: "run",
      command: "npm run dev",
    });
    expect(result.hasMultiple).toBe(false);
  });

  it("extracts a workspace_status directive without requiring a body", () => {
    const result = extractWorkspaceDirective("```workspace_status\n```");

    expect(result.cleanText).toBe("");
    expect(result.directive).toEqual({ action: "status" });
  });

  it("marks multiple directives so the caller can reject them", () => {
    const result = extractWorkspaceDirective(
      "```workspace_status\n```\n```workspace_stop\n```",
    );

    expect(result.directive).toEqual({ action: "status" });
    expect(result.hasMultiple).toBe(true);
  });

  it("treats starting/running/ready jobs as active", () => {
    expect(isWorkspaceJobActive("starting")).toBe(true);
    expect(isWorkspaceJobActive("running")).toBe(true);
    expect(isWorkspaceJobActive("ready")).toBe(true);
    expect(isWorkspaceJobActive("failed")).toBe(false);
    expect(isWorkspaceJobActive("stopped")).toBe(false);
    expect(isWorkspaceJobActive("exited")).toBe(false);
  });

  it("summarizes the current workspace job state", () => {
    expect(
      summarizeWorkspaceJob({
        id: "job-1",
        command: "npm run dev",
        cwd: "/workspace/app",
        status: "ready",
        port: 4173,
        lastOutput: "VITE ready",
      }),
    ).toContain("status=ready");
    expect(
      summarizeWorkspaceJob({
        id: "job-1",
        command: "npm run dev",
        cwd: "/workspace/app",
        status: "ready",
        port: 4173,
        lastOutput: "VITE ready",
      }),
    ).toContain("port=4173");
  });

  it("builds a compact follow-up message for the agent", () => {
    const text = buildWorkspaceDirectiveFollowUp(
      { action: "run", command: "npm run dev" },
      {
        id: "job-1",
        command: "npm run dev",
        cwd: "/workspace/app",
        status: "starting",
      },
      "Workspace job started.",
    );

    expect(text).toContain("action=run");
    expect(text).toContain("Workspace job started.");
    expect(text).toContain("job=job-1");
  });

  it("includes structured diagnostics for failed workspace jobs", () => {
    const snapshot = {
      id: "job-2",
      command: "npm run dev",
      cwd: "/workspace/app",
      status: "failed" as const,
      exitCode: 1,
      lastError: "Error: Cannot find module vite\n    at ...",
      lastOutput: "> app@0.0.0 dev",
    };

    const diagnostics = buildWorkspaceJobDiagnostics(snapshot);
    const text = buildWorkspaceDirectiveFollowUp(
      { action: "run", command: "npm run dev" },
      snapshot,
      "Workspace job failed.",
    );

    expect(diagnostics).toContain("exit_code=1");
    expect(diagnostics).toContain("stderr_tail=Error: Cannot find module vite");
    expect(text).toContain("diagnostics:");
    expect(text).toContain("interpretation=The workspace runtime started the command successfully.");
  });

  it("keeps the tail of long workspace output", () => {
    const value = `line-1\n${"x".repeat(400)}`;
    const truncated = truncateWorkspaceOutputTail(value, 80);

    expect(truncated.startsWith("...")).toBe(true);
    expect(truncated).toContain("x");
    expect(truncated).not.toContain("line-1");
  });

  it("documents the workspace directives in the injected system instructions", () => {
    expect(WORKSPACE_AGENT_APPEND_SYSTEM_MARKDOWN).toContain("workspace_run");
    expect(WORKSPACE_AGENT_APPEND_SYSTEM_MARKDOWN).toContain("workspace_status");
    expect(WORKSPACE_AGENT_APPEND_SYSTEM_MARKDOWN).toContain("workspace_stop");
    expect(WORKSPACE_AGENT_APPEND_SYSTEM_MARKDOWN).toContain("/workspace");
    expect(WORKSPACE_AGENT_APPEND_SYSTEM_MARKDOWN).toContain("not a complete Linux environment");
    expect(WORKSPACE_AGENT_APPEND_SYSTEM_MARKDOWN).toContain("Do not assume Python");
    expect(WORKSPACE_AGENT_APPEND_SYSTEM_MARKDOWN).toContain(WORKSPACE_NODE_SKILL_COMMAND);
  });

  it("prefixes the first normal user prompt with the workspace skill command", () => {
    const prepared = prepareWorkspaceNodeSkillPrompt("Run the app and inspect package.json.", {
      mode: "user",
      alreadyPrimed: false,
    });

    expect(prepared.usedSkill).toBe(true);
    expect(prepared.prompt.startsWith(`${WORKSPACE_NODE_SKILL_COMMAND}\n\n`)).toBe(true);
  });

  it("does not prepend the workspace skill once the session was primed", () => {
    const prepared = prepareWorkspaceNodeSkillPrompt("npm test", {
      mode: "user",
      alreadyPrimed: true,
    });

    expect(prepared.usedSkill).toBe(false);
    expect(prepared.prompt).toBe("npm test");
  });

  it("does not prepend the workspace skill to workspace follow-up prompts", () => {
    const prepared = prepareWorkspaceNodeSkillPrompt("Workspace tool result: ...", {
      mode: "workspace-tool",
      alreadyPrimed: false,
    });

    expect(prepared.usedSkill).toBe(false);
    expect(prepared.prompt).toBe("Workspace tool result: ...");
  });

  it("recognizes manual workspace skill usage without duplicating it", () => {
    const prepared = prepareWorkspaceNodeSkillPrompt(`${WORKSPACE_NODE_SKILL_COMMAND}\nDo the task.`, {
      mode: "user",
      alreadyPrimed: false,
    });

    expect(prepared.usedSkill).toBe(true);
    expect(prepared.prompt).toBe(`${WORKSPACE_NODE_SKILL_COMMAND}\nDo the task.`);
  });

  it("matches the checked-in .pi/APPEND_SYSTEM.md file", async () => {
    const { readFile } = await import("node:fs/promises");
    const { resolve } = await import("node:path");
    const fileContent = await readFile(resolve(process.cwd(), ".pi/APPEND_SYSTEM.md"), "utf8");

    expect(fileContent.trim()).toBe(WORKSPACE_AGENT_APPEND_SYSTEM_MARKDOWN.trim());
  });

  it("matches the checked-in workspace skill file", async () => {
    const { readFile } = await import("node:fs/promises");
    const { resolve } = await import("node:path");
    const fileContent = await readFile(
      resolve(process.cwd(), ".pi/agent/skills/workspace-node/SKILL.md"),
      "utf8",
    );

    expect(fileContent.trim()).toBe(WORKSPACE_NODE_SKILL_MARKDOWN.trim());
  });
});
