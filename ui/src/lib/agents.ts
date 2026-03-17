import type { Thread } from "./protocol";

const AGENT_SOURCE_KINDS = [
  "subAgent",
  "subAgentReview",
  "subAgentCompact",
  "subAgentThreadSpawn",
  "subAgentOther",
] as const;

export function agentSourceKinds() {
  return [...AGENT_SOURCE_KINDS];
}

export function isAgentThread(thread: Thread): boolean {
  if (typeof thread.source === "string") {
    return false;
  }
  return "subagent" in thread.source;
}

export function agentDisplayName(thread: Thread): string {
  return thread.agentNickname || thread.name || thread.agentRole || thread.preview || thread.id;
}

export function agentTypeLabel(thread: Thread): string {
  if (typeof thread.source === "string") {
    return thread.source;
  }

  const source = thread.source.subagent;
  if (typeof source === "string") {
    switch (source) {
      case "review":
        return "Review";
      case "compact":
        return "Compaction";
      case "memory_consolidation":
        return "Memory";
      default:
        return source;
    }
  }

  if ("thread_spawn" in source) {
    return "Spawned agent";
  }

  if ("other" in source) {
    return source.other;
  }

  return "Subagent";
}

export function agentRoleLabel(thread: Thread): string {
  return thread.agentRole || "default";
}
