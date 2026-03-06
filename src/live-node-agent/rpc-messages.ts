export type AgentMessageContentItem = {
  type?: string;
  text?: string;
};

export type AgentMessageLike = {
  role?: string;
  content?: unknown;
};

export function extractAssistantText(message: AgentMessageLike | null | undefined): string {
  if (!message || message.role !== "assistant" || !Array.isArray(message.content)) {
    return "";
  }

  return message.content
    .map((item) => {
      if (!item || typeof item !== "object") return "";
      const candidate = item as AgentMessageContentItem;
      return candidate.type === "text" && typeof candidate.text === "string" ? candidate.text : "";
    })
    .join("")
    .trim();
}

export function extractLatestAssistantText(messages: unknown): string {
  if (!Array.isArray(messages)) {
    return "";
  }

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const text = extractAssistantText(messages[index] as AgentMessageLike);
    if (text) {
      return text;
    }
  }

  return "";
}

export function chooseWorkspaceContinuationCommand(isAgentBusy: boolean): "prompt" | "follow_up" {
  return isAgentBusy ? "follow_up" : "prompt";
}
