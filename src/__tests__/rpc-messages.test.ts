import { describe, expect, it } from "vitest";
import {
  chooseWorkspaceContinuationCommand,
  extractAssistantText,
  extractLatestAssistantText,
} from "../live-node-agent/rpc-messages";

describe("rpc-messages", () => {
  it("extracts assistant text content from a message", () => {
    expect(
      extractAssistantText({
        role: "assistant",
        content: [
          { type: "text", text: "First line. " },
          { type: "tool_use", name: "bash" },
          { type: "text", text: "Second line." },
        ],
      }),
    ).toBe("First line. Second line.");
  });

  it("returns the latest assistant text instead of concatenating earlier turns", () => {
    expect(
      extractLatestAssistantText([
        {
          role: "assistant",
          content: [{ type: "text", text: "I will inspect the repo first." }],
        },
        {
          role: "user",
          content: [{ type: "text", text: "continue" }],
        },
        {
          role: "assistant",
          content: [{ type: "text", text: "Final answer only." }],
        },
      ]),
    ).toBe("Final answer only.");
  });

  it("uses prompt for idle workspace continuations and follow_up only while busy", () => {
    expect(chooseWorkspaceContinuationCommand(false)).toBe("prompt");
    expect(chooseWorkspaceContinuationCommand(true)).toBe("follow_up");
  });
});
