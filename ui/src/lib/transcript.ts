import type { Thread } from "./protocol";
import type { CodexNotification } from "./protocol";
import {
  applyHistoryNotification,
  applyLiveHistoryNotification,
  attachTurn,
  buildHistory,
  buildLiveHistoryTurn,
  findLatestUserPreview,
  splitHistoryView,
  type HistoryItem,
  type HistoryTurn,
  type HistoryView,
  type LiveHistoryItem,
  type LiveHistoryTurn,
} from "./history";

export type TranscriptItem = HistoryItem;
export type TranscriptTurn = HistoryTurn;
export type LiveTranscriptItem = LiveHistoryItem;
export type LiveTranscriptTurn = LiveHistoryTurn;
export type TranscriptView = HistoryView;

export function buildTranscript(thread: Thread | null): TranscriptTurn[] {
  return buildHistory(thread);
}

export function splitTranscriptView(
  turns: TranscriptTurn[],
  activeTurnId: string | null,
): TranscriptView {
  return splitHistoryView(turns, activeTurnId);
}

export function buildLiveTranscriptTurn(
  thread: Thread | null,
  activeTurnId: string | null,
): LiveTranscriptTurn | null {
  return buildLiveHistoryTurn(thread, activeTurnId);
}

export function applyNotification(
  turns: TranscriptTurn[],
  notification: CodexNotification,
): TranscriptTurn[] {
  return applyHistoryNotification(turns, notification);
}

export function applyLiveNotification(
  liveTurn: LiveTranscriptTurn | null,
  notification: CodexNotification,
): LiveTranscriptTurn | null {
  return applyLiveHistoryNotification(liveTurn, notification);
}

export { attachTurn, findLatestUserPreview };

export function latestActivity(turns: TranscriptTurn[]): TranscriptItem[] {
  const currentTurn = turns[0];
  if (!currentTurn) {
    return [];
  }

  return currentTurn.items.filter(
    (item) =>
      item.kind === "command" ||
      item.kind === "file-change" ||
      item.kind === "tool" ||
      item.kind === "event",
  );
}

export function renderTranscriptItem(
  item: TranscriptItem | LiveTranscriptItem,
): string {
  switch (item.kind) {
    case "user":
      return stripSystemReminderBlocks(item.text);
    case "assistant":
      return stripSystemReminderBlocks(item.text);
    case "reasoning":
      return stripSystemReminderBlocks(
        [
          item.summary.length > 0 ? item.summary.join("\n") : "",
          item.content.length > 0 ? item.content.join("\n") : "",
        ]
          .filter(Boolean)
          .join("\n\n"),
      );
    case "plan":
      return stripSystemReminderBlocks(item.text);
    case "system":
      return stripSystemReminderBlocks(`${item.label}: ${item.detail}`.trim());
    case "command":
      return stripSystemReminderBlocks(
        [
          `$ ${item.command}`,
          item.output,
          item.terminalInputs.length > 0
            ? `Terminal input:\n${item.terminalInputs.join("\n")}`
            : "",
          item.exitCode === null ? "" : `Exit code: ${item.exitCode}`,
        ]
          .filter(Boolean)
          .join("\n\n"),
      );
    case "file-change":
      return stripSystemReminderBlocks(
        [item.changes.length > 0 ? item.changes.join("\n") : "", item.output]
          .filter(Boolean)
          .join("\n\n"),
      );
    case "tool":
      return stripSystemReminderBlocks(
        [
          item.input ? `Input:\n${item.input}` : "",
          item.output ? `Output:\n${item.output}` : "",
          item.error ? `Error:\n${item.error}` : "",
        ]
          .filter(Boolean)
          .join("\n\n"),
      );
    case "event":
      return stripSystemReminderBlocks(item.detail);
  }
}

export function renderTranscriptItemMarkdown(
  item: TranscriptItem | LiveTranscriptItem,
): string {
  switch (item.kind) {
    case "user":
      return chatBubbleMarkdown("User:", stripSystemReminderBlocks(item.text));
    case "assistant":
      return chatBubbleMarkdown(
        "Assistant:",
        stripSystemReminderBlocks(item.text),
      );
    case "plan":
      return chatBubbleMarkdown("Plan:", stripSystemReminderBlocks(item.text));
    case "system":
      return chatBubbleMarkdown(
        `${item.label}:`,
        stripSystemReminderBlocks(item.detail),
      );
    case "event":
      return chatBubbleMarkdown(
        `${item.label}:`,
        stripSystemReminderBlocks(item.detail),
      );
    case "reasoning": {
      const sections = [
        item.summary.length > 0 ? item.summary.join("\n") : "",
        item.content.length > 0 ? item.content.join("\n") : "",
      ].filter(Boolean);
      return chatBubbleMarkdown(
        "Reasoning:",
        stripSystemReminderBlocks(sections.join("\n\n")),
      );
    }
    case "command": {
      const sections = [
        markdownCollapsibleCodeSection("Command", item.command, "bash"),
        item.output.trim().length > 0
          ? markdownCodeSection("Output", item.output, "text")
          : "",
        item.terminalInputs.length > 0
          ? markdownCodeSection(
              "Terminal input",
              item.terminalInputs.join("\n"),
              "text",
            )
          : "",
        item.exitCode === null ? "" : `Exit code: \`${item.exitCode}\``,
      ].filter(Boolean);
      return sections.join("\n\n") || "No output yet.";
    }
    case "file-change": {
      const sections = [
        item.changes.length > 0
          ? markdownCodeSection("Changes", item.changes.join("\n"), "diff")
          : "",
        item.output.trim().length > 0
          ? markdownCodeSection("Output", item.output, "text")
          : "",
      ].filter(Boolean);
      return sections.join("\n\n") || "No output yet.";
    }
    case "tool": {
      const sections = [
        `> Tool: ${item.label}`,
        item.input?.trim()
          ? markdownCodeSection(
              "Input",
              item.input,
              guessMarkdownCodeLanguage(item.input),
            )
          : "",
        item.output?.trim()
          ? markdownCodeSection(
              "Output",
              item.output,
              guessMarkdownCodeLanguage(item.output),
            )
          : "",
        item.error?.trim()
          ? markdownCodeSection("Error", item.error, "text")
          : "",
      ].filter(Boolean);
      return sections.join("\n\n") || "No output yet.";
    }
  }
}

export function transcriptItemTitle(
  item: TranscriptItem | LiveTranscriptItem,
): string | null {
  switch (item.kind) {
    case "user":
    case "assistant":
      return null;
    case "reasoning":
      return "Reasoning";
    case "plan":
      return "Plan";
    case "system":
      return item.label;
    case "command":
      return item.command;
    case "file-change":
      return "File changes";
    case "tool":
      return item.label;
    case "event":
      return item.label;
  }
}

export function liveTranscriptItemTitle(
  item: LiveTranscriptItem,
): string | null {
  switch (item.kind) {
    case "assistant":
      return item.status === "streaming" ? "Drafting response" : null;
    case "reasoning":
      return item.status === "streaming" ? "Thinking" : "Reasoning";
    case "plan":
      return item.status === "streaming" ? "Updating plan" : "Plan";
    case "command":
      return item.status === "streaming" ? "Running command" : item.command;
    case "file-change":
      return item.status === "streaming" ? "Updating files" : "File changes";
    case "tool":
      return item.status === "streaming"
        ? `Running ${item.label}`
        : `Completed ${item.label}`;
    case "system":
      return item.label;
    case "event":
      return item.label;
    case "user":
      return null;
  }
}

export function liveTranscriptItemStatus(
  item: LiveTranscriptItem,
): string | null {
  if (!("status" in item)) {
    return null;
  }

  return item.status === "streaming" ? "Live" : "Done";
}

export function liveTurnStatusLabel(turn: LiveTranscriptTurn): string {
  switch (turn.status) {
    case "inProgress":
      return "Live";
    case "interrupted":
      return "Interrupted";
    case "failed":
      return "Failed";
    case "completed":
      return "Completed";
    default:
      return turn.status;
  }
}

export function transcriptTurnStatusLabel(turn: TranscriptTurn): string {
  switch (turn.status) {
    case "inProgress":
      return "Live";
    case "interrupted":
      return "Interrupted turn";
    case "failed":
      return "Failed turn";
    case "completed":
      return "Completed turn";
    default:
      return turn.status;
  }
}

export function transcriptTurnTone(
  turn: TranscriptTurn,
): "warning" | "error" | "neutral" {
  switch (turn.status) {
    case "interrupted":
      return "warning";
    case "failed":
      return "error";
    default:
      return "neutral";
  }
}

function stripSystemReminderBlocks(text: string): string {
  if (!text.includes("<system-reminder>")) {
    return text;
  }

  return text
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>\s*/gi, "")
    .trim();
}

function markdownCodeSection(
  label: string,
  content: string,
  language: string,
): string {
  const normalized = stripSystemReminderBlocks(content).trim();
  if (!normalized) {
    return "";
  }

  const fence = pickMarkdownFence(normalized);
  const languageSuffix = language ? language : "text";
  return `### ${label}\n\n${fence}${languageSuffix}\n${normalized}\n${fence}`;
}

function pickMarkdownFence(content: string): string {
  if (!content.includes("```")) {
    return "```";
  }
  if (!content.includes("````")) {
    return "````";
  }
  return "`````";
}

function chatBubbleMarkdown(label: string, content: string): string {
  const normalized = content.trim();
  if (!normalized) {
    return `> ${label}`;
  }

  const quoted = normalized
    .split("\n")
    .map((line) => `> ${line}`.trimEnd())
    .join("\n");
  return `> ${label}\n>\n${quoted}`;
}

function markdownCollapsibleCodeSection(
  label: string,
  content: string,
  language: string,
): string {
  const normalized = stripSystemReminderBlocks(content).trim();
  if (!normalized) {
    return "";
  }

  const fence = pickMarkdownFence(normalized);
  const languageSuffix = language ? language : "text";
  return [
    `:::codex-collapse[${label}]`,
    "",
    `${fence}${languageSuffix}`,
    normalized,
    fence,
    ":::",
  ].join("\n");
}

function guessMarkdownCodeLanguage(content: string): string {
  const trimmed = stripSystemReminderBlocks(content).trim();
  if (!trimmed) {
    return "text";
  }

  if (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  ) {
    return "json";
  }

  if (
    trimmed.startsWith("<") &&
    trimmed.endsWith(">") &&
    /<[^>]+>/.test(trimmed)
  ) {
    return "html";
  }

  return "text";
}
