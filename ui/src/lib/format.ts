export function formatTime(timestampSeconds: number): string {
  if (!timestampSeconds) {
    return "";
  }

  return new Date(timestampSeconds * 1000).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function truncate(value: string | null | undefined, length = 96): string {
  if (!value) {
    return "";
  }
  if (value.length <= length) {
    return value;
  }
  return `${value.slice(0, length - 1)}…`;
}

export function formatThreadStatus(
  status:
    | { type: "notLoaded" }
    | { type: "idle" }
    | { type: "systemError" }
    | { type: "active"; activeFlags: string[] },
): string {
  if (status.type === "active") {
    return status.activeFlags.length > 0
      ? `active · ${status.activeFlags.join(", ")}`
      : "active";
  }
  return status.type;
}
