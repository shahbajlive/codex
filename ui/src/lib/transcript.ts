import type { Thread, ThreadItem, Turn } from "./protocol";
import type { CodexNotification } from "./protocol";

export type TranscriptItem =
  | {
      id: string;
      kind: "user";
      text: string;
      status?: undefined;
    }
  | {
      id: string;
      kind: "assistant";
      text: string;
      status: "streaming" | "done";
    }
  | {
      id: string;
      kind: "activity";
      label: string;
      detail: string;
      status: "running" | "done";
    };

export type TranscriptTurn = {
  id: string;
  status: string;
  error: string | null;
  items: TranscriptItem[];
};

export function buildTranscript(thread: Thread | null): TranscriptTurn[] {
  if (!thread) {
    return [];
  }

  return thread.turns.map((turn) => ({
    id: turn.id,
    status: turn.status,
    error: turn.error?.message ?? null,
    items: turn.items.map(mapItem).filter((item): item is TranscriptItem => item !== null),
  }));
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
    case "item/started":
      return mutateTurn(turns, notification.params.turnId, (turn) => ({
        ...turn,
        items: upsertItem(turn.items, mapNotificationItem(notification.params.item, "running")),
      }));
    case "item/completed":
      return mutateTurn(turns, notification.params.turnId, (turn) => ({
        ...turn,
        items: upsertItem(turn.items, mapNotificationItem(notification.params.item, "done")),
      }));
    case "item/agentMessage/delta":
      return mutateTurn(turns, notification.params.turnId, (turn) => ({
        ...turn,
        items: appendDelta(turn.items, notification.params.itemId, notification.params.delta),
      }));
    case "turn/completed":
      return mutateTurn(turns, notification.params.turn.id, (turn) => ({
        ...turn,
        status: notification.params.turn.status,
        error: notification.params.turn.error?.message ?? null,
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
  return currentTurn.items.filter((item) => item.kind === "activity");
}

function upsertTurn(turns: TranscriptTurn[], turn: TranscriptTurn): TranscriptTurn[] {
  const existingIndex = turns.findIndex((item) => item.id === turn.id);
  if (existingIndex === -1) {
    return [turn, ...turns];
  }

  return turns.map((item, index) => {
    if (index !== existingIndex) {
      return item;
    }
    return { ...item, ...turn, items: turn.items.length > 0 ? turn.items : item.items };
  });
}

function mutateTurn(
  turns: TranscriptTurn[],
  turnId: string,
  mutate: (turn: TranscriptTurn) => TranscriptTurn,
): TranscriptTurn[] {
  const existingIndex = turns.findIndex((turn) => turn.id === turnId);
  if (existingIndex === -1) {
    return upsertTurn(turns, mutate({ id: turnId, status: "in_progress", error: null, items: [] }));
  }

  return turns.map((turn) => (turn.id === turnId ? mutate(turn) : turn));
}

function upsertItem(items: TranscriptItem[], next: TranscriptItem | null): TranscriptItem[] {
  if (!next) {
    return items;
  }

  const existingIndex = items.findIndex((item) => item.id === next.id);
  if (existingIndex === -1) {
    return [...items, next];
  }

  return items.map((item) => {
    if (item.id !== next.id) {
      return item;
    }
    if (item.kind === "assistant" && next.kind === "assistant") {
      return { ...item, ...next, text: next.text || item.text };
    }
    return next;
  });
}

function appendDelta(items: TranscriptItem[], itemId: string, delta: string): TranscriptItem[] {
  const existingIndex = items.findIndex((item) => item.id === itemId);
  if (existingIndex === -1) {
    return [
      ...items,
      {
        id: itemId,
        kind: "assistant",
        text: delta,
        status: "streaming",
      },
    ];
  }

  return items.map((item) => {
    if (item.id !== itemId || item.kind !== "assistant") {
      return item;
    }
    return {
      ...item,
      text: `${item.text}${delta}`,
      status: "streaming",
    };
  });
}

function mapNotificationItem(item: ThreadItem, status: "running" | "done"): TranscriptItem | null {
  return mapItem(item, status);
}

function mapItem(item: ThreadItem, activityStatus: "running" | "done" = "done"): TranscriptItem | null {
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
        status: activityStatus === "running" ? "streaming" : "done",
      };
    case "commandExecution":
      return {
        id: item.id,
        kind: "activity",
        label: item.command,
        detail: item.aggregatedOutput ?? item.cwd,
        status: activityStatus,
      };
    case "mcpToolCall":
      return {
        id: item.id,
        kind: "activity",
        label: `${item.server}:${item.tool}`,
        detail: item.status,
        status: activityStatus,
      };
    case "dynamicToolCall":
      return {
        id: item.id,
        kind: "activity",
        label: item.tool,
        detail: item.status,
        status: activityStatus,
      };
    case "plan":
      return {
        id: item.id,
        kind: "activity",
        label: "Plan",
        detail: item.text,
        status: activityStatus,
      };
    default:
      return null;
  }
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
