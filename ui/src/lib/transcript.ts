import type { Thread, ThreadItem, Turn } from "./protocol";
import type { CodexNotification } from "./protocol";

type ItemLifecycle = "streaming" | "done";

const TERMINAL_EVENT_SUFFIX = ":terminal";
const INTERRUPTED_TURN_MESSAGE =
  "Conversation interrupted - tell the model what to do differently. Something went wrong? Hit `/feedback` to report the issue.";
const REPLACED_TURN_MESSAGE = "Turn aborted: replaced by a new task";

export type TranscriptItem =
  | {
      id: string;
      kind: "user";
      text: string;
    }
  | {
      id: string;
      kind: "assistant";
      text: string;
      status: ItemLifecycle;
    }
  | {
      id: string;
      kind: "reasoning";
      summary: string[];
      content: string[];
      status: ItemLifecycle;
    }
  | {
      id: string;
      kind: "plan";
      text: string;
      status: ItemLifecycle;
    }
  | {
      id: string;
      kind: "command";
      command: string;
      cwd: string;
      output: string;
      exitCode: number | null;
      terminalInputs: string[];
      status: ItemLifecycle;
    }
  | {
      id: string;
      kind: "file-change";
      changes: string[];
      output: string;
      status: ItemLifecycle;
    }
  | {
      id: string;
      kind: "tool";
      label: string;
      detail: string;
      status: ItemLifecycle;
    }
  | {
      id: string;
      kind: "event";
      label: string;
      detail: string;
      tone: "info" | "warning" | "error";
    };

export type TranscriptTurn = {
  id: string;
  status: string;
  error: string | null;
  items: TranscriptItem[];
};

export type LiveTranscriptItem =
  | {
      id: string;
      kind: "user";
      text: string;
    }
  | {
      id: string;
      kind: "assistant";
      text: string;
      status: ItemLifecycle;
    }
  | {
      id: string;
      kind: "reasoning";
      summary: string[];
      content: string[];
      status: ItemLifecycle;
    }
  | {
      id: string;
      kind: "plan";
      text: string;
      status: ItemLifecycle;
    }
  | {
      id: string;
      kind: "command";
      command: string;
      cwd: string;
      output: string;
      exitCode: number | null;
      terminalInputs: string[];
      status: ItemLifecycle;
    }
  | {
      id: string;
      kind: "file-change";
      changes: string[];
      output: string;
      status: ItemLifecycle;
    }
  | {
      id: string;
      kind: "tool";
      label: string;
      detail: string;
      status: ItemLifecycle;
    }
  | {
      id: string;
      kind: "event";
      label: string;
      detail: string;
      tone: "info" | "warning" | "error";
    };

export type LiveTranscriptTurn = {
  id: string;
  status: string;
  error: string | null;
  events: Array<{
    id: string;
    label: string;
    detail: string;
    tone: "info" | "warning" | "error";
  }>;
  items: LiveTranscriptItem[];
};

export type TranscriptView = {
  committedTurns: TranscriptTurn[];
  liveTurn: TranscriptTurn | null;
};

export function buildTranscript(thread: Thread | null): TranscriptTurn[] {
  if (!thread) {
    return [];
  }

  return thread.turns.map((turn) => ({
    id: turn.id,
    status: turn.status,
    error: turn.error?.message ?? null,
    items: appendTerminalTurnEvent(
      turn.items
        .map((item) => mapItem(item, "done"))
        .filter((item): item is TranscriptItem => item !== null),
      turn.id,
      turn.status,
      turn.error?.message ?? null,
    ),
  }));
}

export function splitTranscriptView(
  turns: TranscriptTurn[],
  activeTurnId: string | null,
): TranscriptView {
  const liveTurn = selectLiveTurn(turns, activeTurnId);
  if (!liveTurn) {
    return { committedTurns: turns, liveTurn: null };
  }

  return {
    committedTurns: turns.filter((turn) => turn.id !== liveTurn.id),
    liveTurn,
  };
}

export function buildLiveTranscriptTurn(
  thread: Thread | null,
  activeTurnId: string | null,
): LiveTranscriptTurn | null {
  if (!thread) {
    return null;
  }

  const liveTurnId = activeTurnId ?? findActiveTurnId(thread);
  if (!liveTurnId) {
    return null;
  }

  const turn = thread.turns.find((item) => item.id === liveTurnId);
  if (!turn) {
    return null;
  }

  return {
    id: turn.id,
    status: turn.status,
    error: turn.error?.message ?? null,
    events: [],
    items: turn.items
      .map((item) =>
        mapItem(item, turn.status === "inProgress" ? "streaming" : "done"),
      )
      .filter((item): item is TranscriptItem => item !== null),
  };
}

export function applyLiveNotification(
  liveTurn: LiveTranscriptTurn | null,
  notification: CodexNotification,
): LiveTranscriptTurn | null {
  switch (notification.method) {
    case "turn/started":
      return {
        id: notification.params.turn.id,
        status: notification.params.turn.status,
        error: notification.params.turn.error?.message ?? null,
        events: [],
        items: [],
      };
    case "turn/aborted":
      return liveTurn?.id === notification.params.turnId ? null : liveTurn;
    case "turn/completed":
      return liveTurn?.id === notification.params.turn.id ? null : liveTurn;
    case "error":
      if (!liveTurn || liveTurn.id !== notification.params.turnId) {
        return liveTurn;
      }
      if (notification.params.willRetry) {
        return {
          ...liveTurn,
          events: appendLiveEvent(liveTurn.events, {
            id: `${notification.params.turnId}:retry`,
            label: "Retrying",
            detail: notification.params.error.message,
            tone: "warning",
          }),
        };
      }
      return {
        ...liveTurn,
        error: notification.params.error.message,
        events: appendLiveEvent(liveTurn.events, {
          id: `${notification.params.turnId}:error`,
          label: "Error",
          detail: notification.params.error.message,
          tone: "error",
        }),
      };
    case "item/started":
      if (!liveTurn || liveTurn.id !== notification.params.turnId) {
        return liveTurn;
      }
      return {
        ...applyLiveNotificationUpdate(liveTurn, notification),
        events: appendLiveEvent(
          liveTurn.events,
          liveProgressEvent(notification.params.item),
        ),
      };
    case "item/completed":
      if (!liveTurn || liveTurn.id !== notification.params.turnId) {
        return liveTurn;
      }
      return {
        ...applyLiveNotificationUpdate(liveTurn, notification),
        events: removeLiveEventByPrefix(
          liveTurn.events,
          `${notification.params.item.id}:progress`,
        ),
      };
    default:
      if (!liveTurn) {
        return liveTurn;
      }
      return applyLiveNotificationUpdate(liveTurn, notification);
  }
}

function applyLiveNotificationUpdate(
  liveTurn: LiveTranscriptTurn,
  notification: CodexNotification,
): LiveTranscriptTurn {
  return (applyNotification(
    [
      {
        id: liveTurn.id,
        status: liveTurn.status,
        error: liveTurn.error,
        items: liveTurn.items,
      },
    ],
    notification,
  )[0] ?? {
    id: liveTurn.id,
    status: liveTurn.status,
    error: liveTurn.error,
    events: liveTurn.events,
    items: liveTurn.items,
  }) as LiveTranscriptTurn;
}

function appendLiveEvent(
  events: LiveTranscriptTurn["events"],
  event: LiveTranscriptTurn["events"][number],
): LiveTranscriptTurn["events"] {
  const next = events.filter((item) => item.id !== event.id);
  return [...next, event];
}

function removeLiveEventByPrefix(
  events: LiveTranscriptTurn["events"],
  prefix: string,
): LiveTranscriptTurn["events"] {
  return events.filter((item) => !item.id.startsWith(prefix));
}

function liveProgressEvent(
  item: ThreadItem,
): LiveTranscriptTurn["events"][number] {
  return {
    id: `${item.id}:progress`,
    label: "In progress",
    detail: describeLiveItemProgress(item),
    tone: "info",
  };
}

function describeLiveItemProgress(item: ThreadItem): string {
  switch (item.type) {
    case "commandExecution":
      return item.command ? `Running ${item.command}` : "Running command";
    case "fileChange":
      return "Updating files";
    case "reasoning":
      return "Thinking";
    case "plan":
      return "Updating plan";
    case "agentMessage":
      return "Drafting response";
    case "mcpToolCall":
      return `Running ${item.server}:${item.tool}`;
    case "dynamicToolCall":
      return `Running ${item.tool}`;
    case "webSearch":
      return `Searching web for ${item.query}`;
    case "imageGeneration":
      return "Generating image";
    case "imageView":
      return `Opening ${item.path}`;
    case "userMessage":
      return "Sending message";
  }

  return "Working";
}

export function applyNotification(
  turns: TranscriptTurn[],
  notification: CodexNotification,
): TranscriptTurn[] {
  switch (notification.method) {
    case "turn/started":
      return upsertTurn(turns, {
        id: notification.params.turn.id,
        status: notification.params.turn.status,
        error: notification.params.turn.error?.message ?? null,
        items: [],
      });
    case "turn/aborted":
      return mutateTurn(turns, notification.params.turnId, (turn) => ({
        ...turn,
        status: "interrupted",
        error: null,
        items: appendTerminalTurnEvent(
          turn.items,
          notification.params.turnId,
          "interrupted",
          null,
          notification.params.reason,
        ),
      }));
    case "item/started":
      return mutateTurn(turns, notification.params.turnId, (turn) => ({
        ...turn,
        items: upsertItem(
          turn.items,
          mapItem(notification.params.item, "streaming"),
        ),
      }));
    case "item/completed":
      return mutateTurn(turns, notification.params.turnId, (turn) => ({
        ...turn,
        items: upsertItem(
          turn.items,
          mapItem(notification.params.item, "done"),
        ),
      }));
    case "item/agentMessage/delta":
      return mutateTurn(turns, notification.params.turnId, (turn) => ({
        ...turn,
        items: appendTextDelta(
          turn.items,
          notification.params.itemId,
          "assistant",
          notification.params.delta,
        ),
      }));
    case "item/plan/delta":
      return mutateTurn(turns, notification.params.turnId, (turn) => ({
        ...turn,
        items: appendTextDelta(
          turn.items,
          notification.params.itemId,
          "plan",
          notification.params.delta,
        ),
      }));
    case "item/reasoning/summaryPartAdded":
      return mutateTurn(turns, notification.params.turnId, (turn) => ({
        ...turn,
        items: ensureReasoningIndex(
          turn.items,
          notification.params.itemId,
          "summary",
          notification.params.summaryIndex,
        ),
      }));
    case "item/reasoning/summaryTextDelta":
      return mutateTurn(turns, notification.params.turnId, (turn) => ({
        ...turn,
        items: appendReasoningDelta(
          turn.items,
          notification.params.itemId,
          "summary",
          notification.params.summaryIndex,
          notification.params.delta,
        ),
      }));
    case "item/reasoning/textDelta":
      return mutateTurn(turns, notification.params.turnId, (turn) => ({
        ...turn,
        items: appendReasoningDelta(
          turn.items,
          notification.params.itemId,
          "content",
          notification.params.contentIndex,
          notification.params.delta,
        ),
      }));
    case "item/commandExecution/outputDelta":
      return mutateTurn(turns, notification.params.turnId, (turn) => ({
        ...turn,
        items: appendCommandOutput(
          turn.items,
          notification.params.itemId,
          notification.params.delta,
        ),
      }));
    case "item/commandExecution/terminalInteraction":
      return mutateTurn(turns, notification.params.turnId, (turn) => ({
        ...turn,
        items: appendTerminalInput(
          turn.items,
          notification.params.itemId,
          notification.params.stdin,
        ),
      }));
    case "item/fileChange/outputDelta":
      return mutateTurn(turns, notification.params.turnId, (turn) => ({
        ...turn,
        items: appendFileChangeOutput(
          turn.items,
          notification.params.itemId,
          notification.params.delta,
        ),
      }));
    case "turn/plan/updated":
      return mutateTurn(turns, notification.params.turnId, (turn) => ({
        ...turn,
        items: upsertItem(turn.items, {
          id: `${notification.params.turnId}:plan-update`,
          kind: "event",
          label: "Plan updated",
          detail: formatTurnPlan(
            notification.params.explanation,
            notification.params.plan,
          ),
          tone: "info",
        }),
      }));
    case "turn/diff/updated":
      return mutateTurn(turns, notification.params.turnId, (turn) => ({
        ...turn,
        items: upsertItem(turn.items, {
          id: `${notification.params.turnId}:diff-update`,
          kind: "event",
          label: "Diff updated",
          detail: notification.params.diff,
          tone: "info",
        }),
      }));
    case "error":
      if (notification.params.willRetry) {
        return turns;
      }
      return mutateTurn(turns, notification.params.turnId, (turn) => ({
        ...turn,
        error: notification.params.error.message,
      }));
    case "turn/completed":
      return mutateTurn(turns, notification.params.turn.id, (turn) => ({
        ...turn,
        status: notification.params.turn.status,
        error: notification.params.turn.error?.message ?? null,
        items: appendTerminalTurnEvent(
          turn.items,
          notification.params.turn.id,
          notification.params.turn.status,
          notification.params.turn.error?.message ?? null,
        ),
      }));
    case "thread/started":
    default:
      return turns;
  }
}

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
    case "assistant":
      return item.text;
    case "reasoning":
      return [
        item.summary.length > 0 ? item.summary.join("\n") : "",
        item.content.length > 0 ? item.content.join("\n") : "",
      ]
        .filter(Boolean)
        .join("\n\n");
    case "plan":
      return item.text;
    case "command":
      return [
        `$ ${item.command}`,
        item.output,
        item.terminalInputs.length > 0
          ? `Terminal input:\n${item.terminalInputs.join("\n")}`
          : "",
        item.exitCode === null ? "" : `Exit code: ${item.exitCode}`,
      ]
        .filter(Boolean)
        .join("\n\n");
    case "file-change":
      return [
        item.changes.length > 0 ? item.changes.join("\n") : "",
        item.output,
      ]
        .filter(Boolean)
        .join("\n\n");
    case "tool":
      return item.detail;
    case "event":
      return item.detail;
  }
}

export function transcriptItemTitle(
  item: TranscriptItem | LiveTranscriptItem,
): string | null {
  switch (item.kind) {
    case "user":
      return null;
    case "assistant":
      return null;
    case "reasoning":
      return "Reasoning";
    case "plan":
      return "Plan";
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
      return item.status === "streaming" ? `${item.label} running` : item.label;
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

function upsertTurn(
  turns: TranscriptTurn[],
  turn: TranscriptTurn,
): TranscriptTurn[] {
  const existingIndex = turns.findIndex((item) => item.id === turn.id);
  if (existingIndex === -1) {
    return [turn, ...turns];
  }

  return turns.map((item, index) => {
    if (index !== existingIndex) {
      return item;
    }
    return {
      ...item,
      ...turn,
      items: turn.items.length > 0 ? turn.items : item.items,
    };
  });
}

function mutateTurn(
  turns: TranscriptTurn[],
  turnId: string,
  mutate: (turn: TranscriptTurn) => TranscriptTurn,
): TranscriptTurn[] {
  const existingIndex = turns.findIndex((turn) => turn.id === turnId);
  if (existingIndex === -1) {
    return upsertTurn(
      turns,
      mutate({ id: turnId, status: "inProgress", error: null, items: [] }),
    );
  }

  return turns.map((turn) => (turn.id === turnId ? mutate(turn) : turn));
}

function upsertItem(
  items: TranscriptItem[],
  next: TranscriptItem | null,
): TranscriptItem[] {
  if (!next) {
    return items;
  }

  const existingIndex = items.findIndex((item) => item.id === next.id);
  if (existingIndex === -1) {
    return [...items, next];
  }

  return items.map((item) =>
    item.id === next.id ? mergeItem(item, next) : item,
  );
}

function mergeItem(
  current: TranscriptItem,
  next: TranscriptItem,
): TranscriptItem {
  if (current.kind !== next.kind) {
    return next;
  }

  switch (current.kind) {
    case "user":
      return next;
    case "assistant":
      return {
        id: current.id,
        kind: "assistant",
        text: next.kind === "assistant" && next.text ? next.text : current.text,
        status: next.kind === "assistant" ? next.status : current.status,
      };
    case "reasoning":
      return {
        id: current.id,
        kind: "reasoning",
        summary:
          next.kind === "reasoning" && next.summary.length > 0
            ? next.summary
            : current.summary,
        content:
          next.kind === "reasoning" && next.content.length > 0
            ? next.content
            : current.content,
        status: next.kind === "reasoning" ? next.status : current.status,
      };
    case "plan":
      return {
        id: current.id,
        kind: "plan",
        text: next.kind === "plan" && next.text ? next.text : current.text,
        status: next.kind === "plan" ? next.status : current.status,
      };
    case "command":
      return {
        id: current.id,
        kind: "command",
        command: next.kind === "command" ? next.command : current.command,
        cwd: next.kind === "command" ? next.cwd : current.cwd,
        output:
          next.kind === "command" && next.output ? next.output : current.output,
        exitCode: next.kind === "command" ? next.exitCode : current.exitCode,
        terminalInputs:
          next.kind === "command" && next.terminalInputs.length > 0
            ? next.terminalInputs
            : current.terminalInputs,
        status: next.kind === "command" ? next.status : current.status,
      };
    case "file-change":
      return {
        id: current.id,
        kind: "file-change",
        output:
          next.kind === "file-change" && next.output
            ? next.output
            : current.output,
        changes:
          next.kind === "file-change" && next.changes.length > 0
            ? next.changes
            : current.changes,
        status: next.kind === "file-change" ? next.status : current.status,
      };
    case "tool":
      return {
        id: current.id,
        kind: "tool",
        label: next.kind === "tool" ? next.label : current.label,
        detail:
          next.kind === "tool" && next.detail ? next.detail : current.detail,
        status: next.kind === "tool" ? next.status : current.status,
      };
    case "event":
      return next;
  }
}

function appendTerminalTurnEvent(
  items: TranscriptItem[],
  turnId: string,
  status: string,
  error: string | null,
  reason?: string,
): TranscriptItem[] {
  const event = terminalTurnEvent(turnId, status, error, reason);
  const next = items.filter(
    (item) => item.id !== `${turnId}${TERMINAL_EVENT_SUFFIX}`,
  );
  return event ? [...next, event] : next;
}

function terminalTurnEvent(
  turnId: string,
  status: string,
  error: string | null,
  reason?: string,
): TranscriptItem | null {
  if (status === "failed" && error) {
    return {
      id: `${turnId}${TERMINAL_EVENT_SUFFIX}`,
      kind: "event",
      label: "Error",
      detail: error,
      tone: "error",
    };
  }

  if (status !== "interrupted") {
    return null;
  }

  if (reason === "reviewEnded") {
    return null;
  }

  return {
    id: `${turnId}${TERMINAL_EVENT_SUFFIX}`,
    kind: "event",
    label: reason === "replaced" ? "Turn replaced" : "Conversation interrupted",
    detail:
      reason === "replaced" ? REPLACED_TURN_MESSAGE : INTERRUPTED_TURN_MESSAGE,
    tone: reason === "replaced" ? "warning" : "error",
  };
}

function appendTextDelta(
  items: TranscriptItem[],
  itemId: string,
  kind: "assistant" | "plan",
  delta: string,
): TranscriptItem[] {
  const existing = items.find((item) => item.id === itemId);
  if (!existing || existing.kind !== kind) {
    const next: TranscriptItem =
      kind === "assistant"
        ? { id: itemId, kind: "assistant", text: delta, status: "streaming" }
        : { id: itemId, kind: "plan", text: delta, status: "streaming" };
    return [...items, next];
  }

  return items.map((item) => {
    if (item.id !== itemId || item.kind !== kind) {
      return item;
    }
    return {
      ...item,
      text: `${item.text}${delta}`,
      status: "streaming",
    };
  });
}

function selectLiveTurn(
  turns: TranscriptTurn[],
  activeTurnId: string | null,
): TranscriptTurn | null {
  if (activeTurnId) {
    return turns.find((turn) => turn.id === activeTurnId) ?? null;
  }

  return (
    [...turns].reverse().find((turn) => turn.status === "inProgress") ?? null
  );
}

function findActiveTurnId(thread: Thread): string | null {
  for (let index = thread.turns.length - 1; index >= 0; index -= 1) {
    const turn = thread.turns[index];
    if (turn?.status === "inProgress") {
      return turn.id;
    }
  }

  return null;
}

function ensureReasoningIndex(
  items: TranscriptItem[],
  itemId: string,
  target: "summary" | "content",
  index: number,
): TranscriptItem[] {
  return items.map((item) => {
    if (item.id !== itemId || item.kind !== "reasoning") {
      return item;
    }

    const next = [...item[target]];
    while (next.length <= index) {
      next.push("");
    }

    return {
      ...item,
      [target]: next,
      status: "streaming",
    };
  });
}

function appendReasoningDelta(
  items: TranscriptItem[],
  itemId: string,
  target: "summary" | "content",
  index: number,
  delta: string,
): TranscriptItem[] {
  const existing = items.find((item) => item.id === itemId);
  if (!existing || existing.kind !== "reasoning") {
    const summary = target === "summary" ? emptyFilled(index, delta) : [];
    const content = target === "content" ? emptyFilled(index, delta) : [];
    return [
      ...items,
      {
        id: itemId,
        kind: "reasoning",
        summary,
        content,
        status: "streaming",
      },
    ];
  }

  return items.map((item) => {
    if (item.id !== itemId || item.kind !== "reasoning") {
      return item;
    }

    const next = [...item[target]];
    while (next.length <= index) {
      next.push("");
    }
    next[index] = `${next[index] ?? ""}${delta}`;

    return {
      ...item,
      [target]: next,
      status: "streaming",
    };
  });
}

function appendCommandOutput(
  items: TranscriptItem[],
  itemId: string,
  delta: string,
): TranscriptItem[] {
  return items.map((item) => {
    if (item.id !== itemId || item.kind !== "command") {
      return item;
    }
    return {
      ...item,
      output: `${item.output}${delta}`,
      status: "streaming",
    };
  });
}

function appendTerminalInput(
  items: TranscriptItem[],
  itemId: string,
  stdin: string,
): TranscriptItem[] {
  return items.map((item) => {
    if (item.id !== itemId || item.kind !== "command") {
      return item;
    }
    return {
      ...item,
      terminalInputs: [...item.terminalInputs, stdin],
      status: "streaming",
    };
  });
}

function appendFileChangeOutput(
  items: TranscriptItem[],
  itemId: string,
  delta: string,
): TranscriptItem[] {
  return items.map((item) => {
    if (item.id !== itemId || item.kind !== "file-change") {
      return item;
    }
    return {
      ...item,
      output: `${item.output}${delta}`,
      status: "streaming",
    };
  });
}

function mapItem(
  item: ThreadItem,
  lifecycle: ItemLifecycle = "done",
): TranscriptItem | null {
  switch (item.type) {
    case "userMessage":
      return {
        id: item.id,
        kind: "user",
        text: item.content
          .map((entry) => {
            if (entry.type === "text") {
              return entry.text;
            }
            if (entry.type === "mention" || entry.type === "skill") {
              return `@${entry.name}`;
            }
            if (entry.type === "localImage") {
              return `[image:${entry.path}]`;
            }
            return `[${entry.type}]`;
          })
          .join("\n"),
      };
    case "agentMessage":
      return {
        id: item.id,
        kind: "assistant",
        text: item.text,
        status: lifecycle,
      };
    case "reasoning":
      return {
        id: item.id,
        kind: "reasoning",
        summary: item.summary,
        content: item.content,
        status: lifecycle,
      };
    case "plan":
      return {
        id: item.id,
        kind: "plan",
        text: item.text,
        status: lifecycle,
      };
    case "commandExecution":
      return {
        id: item.id,
        kind: "command",
        command: item.command,
        cwd: item.cwd,
        output: item.aggregatedOutput ?? "",
        exitCode: item.exitCode,
        terminalInputs: [],
        status: lifecycle,
      };
    case "fileChange":
      return {
        id: item.id,
        kind: "file-change",
        changes: item.changes.map((change) => change.path),
        output: "",
        status: lifecycle,
      };
    case "mcpToolCall":
      return {
        id: item.id,
        kind: "tool",
        label: `${item.server}:${item.tool}`,
        detail:
          item.error?.message ??
          item.result?.content
            .map((content) => renderToolContent(content))
            .join("\n") ??
          item.status,
        status: lifecycle,
      };
    case "dynamicToolCall":
      return {
        id: item.id,
        kind: "tool",
        label: item.tool,
        detail:
          item.contentItems
            ?.map((content) => renderToolContent(content))
            .join("\n") || (item.success === false ? "failed" : item.status),
        status: lifecycle,
      };
    case "webSearch":
      return {
        id: item.id,
        kind: "tool",
        label: `Web search: ${item.query}`,
        detail: item.action?.type ?? "searching",
        status: lifecycle,
      };
    case "imageGeneration":
      return {
        id: item.id,
        kind: "event",
        label: "Image generation",
        detail: item.result,
        tone: "info",
      };
    case "imageView":
      return {
        id: item.id,
        kind: "event",
        label: "Image viewed",
        detail: item.path,
        tone: "info",
      };
    case "enteredReviewMode":
    case "exitedReviewMode":
      return {
        id: item.id,
        kind: "event",
        label:
          item.type === "enteredReviewMode"
            ? "Entered review"
            : "Exited review",
        detail: item.review,
        tone: "info",
      };
    case "hookPrompt":
      return {
        id: item.id,
        kind: "event",
        label: "Hook prompt",
        detail: item.fragments.map((fragment) => fragment.text).join(""),
        tone: "warning",
      };
    case "collabAgentToolCall":
      return {
        id: item.id,
        kind: "tool",
        label: item.tool,
        detail: item.prompt ?? item.receiverThreadIds.join(", "),
        status: lifecycle,
      };
    case "contextCompaction":
      return {
        id: item.id,
        kind: "event",
        label: "Context compacted",
        detail: "Conversation context was compacted.",
        tone: "info",
      };
    default:
      return null;
  }
}

function renderToolContent(content: unknown): string {
  if (
    content &&
    typeof content === "object" &&
    "type" in content &&
    content.type === "text" &&
    "text" in content &&
    typeof content.text === "string"
  ) {
    return content.text;
  }
  return JSON.stringify(content, null, 2);
}

function emptyFilled(index: number, delta: string): string[] {
  const values = Array.from({ length: index + 1 }, () => "");
  values[index] = delta;
  return values;
}

function formatTurnPlan(
  explanation: string | null,
  plan: Array<{ step: string; status: string }>,
): string {
  const steps = plan
    .map((step) => `- [${step.status}] ${step.step}`)
    .join("\n");
  return [explanation ?? "", steps].filter(Boolean).join("\n\n");
}

export function findLatestUserPreview(thread: Thread): string {
  for (const turn of thread.turns) {
    for (const item of turn.items) {
      if (item.type === "userMessage") {
        const text = item.content.find((entry) => entry.type === "text");
        if (text?.text) {
          return text.text;
        }
      }
    }
  }
  return thread.preview;
}

export function attachTurn(thread: Thread, turn: Turn): Thread {
  const existingIndex = thread.turns.findIndex((item) => item.id === turn.id);
  if (existingIndex === -1) {
    return { ...thread, turns: [turn, ...thread.turns] };
  }

  return {
    ...thread,
    turns: thread.turns.map((item) => (item.id === turn.id ? turn : item)),
  };
}
