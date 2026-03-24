<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { Model, Thread, ThreadTokenUsage } from "../lib/protocol";
import { slashCommands } from "../lib/slash-commands";
import {
  type LiveTranscriptTurn,
  type TranscriptTurn,
} from "../lib/transcript";
import { formatTime, truncate } from "../lib/format";
import type {
  WorkspaceAgentRow,
  WorkspacePendingRequest,
} from "../stores/chat/workspace-messages";
import WorkspaceAgentList from "./chat/WorkspaceAgentList.vue";
import WorkspaceCommandControl from "./chat/WorkspaceCommandControl.vue";
import WorkspaceComposer from "./chat/WorkspaceComposer.vue";
import WorkspacePendingRequestPanel from "./chat/WorkspacePendingRequestPanel.vue";
import WorkspaceThreadHeader from "./chat/WorkspaceThreadHeader.vue";
import WorkspaceTranscriptView from "./chat/WorkspaceTranscriptView.vue";

const props = defineProps<{
  autoCompactTokenLimit: number | null;
  loading: boolean;
  connected: boolean;
  contextWindow: number | null;
  agents: WorkspaceAgentRow[];
  modelLabel: string;
  models: Model[];
  modelProviders: string[];
  pendingRequest: WorkspacePendingRequest | null;
  restoredDraft: string | null;
  restoredDraftVersion: number;
  pendingUserDraft: string | null;
  statusMessage: string | null;
  statusTone: "info" | "warning" | "error" | null;
  activeTurnId: string | null;
  committedTranscript: TranscriptTurn[];
  liveTranscriptTurn: LiveTranscriptTurn | null;
  selectedAgentId: string | null;
  selectedModelProvider: string | null;
  selectedAgentThreadIds: string[];
  selectedThreadId: string | null;
  selectedTokenUsage: ThreadTokenUsage | null;
  collapseOverrides: Record<string, boolean>;
  theme: string;
  threads: Thread[];
}>();

const emit = defineEmits<{
  refresh: [];
  rejectRequest: [message?: string];
  resolveRequest: [response: unknown];
  select: [threadId: string];
  selectThread: [threadId: string];
  send: [message: string];
  interrupt: [];
  openConversation: [];
  setCollapseOverride: [key: string, expanded: boolean];
  setCollapseOverrides: [updates: Record<string, boolean>];
}>();

const draft = ref("");
const search = ref("");
const sidebarCollapsed = ref(false);
const promptAnswers = ref<Record<string, string>>({});
const elicitationAnswers = ref<Record<string, string | boolean>>({});
const dynamicToolResult = ref("");
const dynamicToolSuccess = ref(true);
const activeCommandIndex = ref(0);
const commandControlOpen = ref(false);
const commandControlQuery = ref("");

const selectedAgent = computed(
  () =>
    props.agents.find((agent) => agent.id === props.selectedAgentId) ?? null,
);

const AGENT_FALLBACK_COLORS = [
  "#6366f1",
  "#8b5cf6",
  "#22c55e",
  "#f59e0b",
  "#ef4444",
  "#06b6d4",
  "#3b82f6",
  "#ec4899",
];

function hashColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AGENT_FALLBACK_COLORS[Math.abs(hash) % AGENT_FALLBACK_COLORS.length];
}

function resolvedAgentColor(agent: WorkspaceAgentRow | null): string {
  if (!agent) {
    return "var(--accent)";
  }
  return agent.color || hashColor(agent.name || agent.id);
}

const selectedAgentColor = computed(() =>
  resolvedAgentColor(selectedAgent.value),
);

const workspaceColorVars = computed(() => ({
  "--workspace-agent-color": selectedAgentColor.value,
}));

function agentAvatarStyle(agent: WorkspaceAgentRow) {
  const color = resolvedAgentColor(agent);
  return {
    backgroundColor: `${color}1f`,
    color,
  };
}

const selectedAgentAvatarStyle = computed(() => {
  const color = selectedAgentColor.value;
  return {
    backgroundColor: `${color}1f`,
    color,
  };
});

const filteredAgents = computed(() => {
  const query = search.value.trim().toLowerCase();
  if (!query) {
    return props.agents;
  }

  return props.agents.filter((agent) => {
    const haystack =
      `${agent.name} ${agent.description} ${agent.preview} ${agent.workspace || ""}`.toLowerCase();
    return haystack.includes(query);
  });
});

type ThreadChoice = {
  id: string;
  label: string;
};

const threadChoices = computed<ThreadChoice[]>(() => {
  const threadsById = new Map(
    props.threads.map((thread) => [thread.id, thread]),
  );
  const sortedThreadIds = [...props.selectedAgentThreadIds].sort(
    (left, right) => {
      const leftThread = threadsById.get(left);
      const rightThread = threadsById.get(right);
      if (leftThread && rightThread) {
        return rightThread.updatedAt - leftThread.updatedAt;
      }
      if (rightThread) {
        return 1;
      }
      if (leftThread) {
        return -1;
      }
      return (
        props.selectedAgentThreadIds.indexOf(left) -
        props.selectedAgentThreadIds.indexOf(right)
      );
    },
  );

  const choices = sortedThreadIds.map((threadId) => {
    const thread = threadsById.get(threadId);
    if (thread) {
      const primary = thread.name || thread.preview || thread.id;
      const stamp = formatTime(thread.updatedAt) || "recent";
      return {
        id: thread.id,
        label: `${primary} · ${stamp}`,
      };
    }

    return {
      id: threadId,
      label: `${threadId} · not materialized yet`,
    };
  });

  if (
    props.selectedThreadId &&
    !choices.some((choice) => choice.id === props.selectedThreadId)
  ) {
    choices.unshift({
      id: props.selectedThreadId,
      label: `${props.selectedThreadId} · current`,
    });
  }

  return choices;
});

function onThreadSelectionChange(event: Event) {
  const threadId = (event.target as HTMLSelectElement).value;
  if (!threadId || threadId === props.selectedThreadId) {
    return;
  }
  emit("selectThread", threadId);
}

const composerMeta = computed(() => [
  props.autoCompactTokenLimit
    ? `Auto-compact ${formatTokenCount(props.autoCompactTokenLimit)}`
    : null,
]);

const composerModelUsageLine = computed(() => {
  const modelName = props.modelLabel || "default";
  const consumed = formatTokenCount(
    props.selectedTokenUsage?.total.totalTokens ?? 0,
  );
  const capacity = formatTokenCount(
    props.contextWindow ?? props.selectedTokenUsage?.modelContextWindow ?? 0,
  );
  return `${modelName} - ${consumed}/${capacity}`;
});

const COMMAND_PANEL_PREFIXES = new Set([
  "/model",
  "/resume",
  "/agent",
  "/subagents",
  "/approvals",
  "/permissions",
  "/settings",
]);

const COMMANDS_REQUIRING_THREAD = new Set([
  "/rename",
  "/compact",
  "/fork",
  "/diff",
  "/copy",
  "/review",
]);

const activeCommandQuery = computed(() => commandControlQuery.value.trim());

const selectedThread = computed(
  () =>
    props.threads.find((thread) => thread.id === props.selectedThreadId) ??
    null,
);

const commandContextLabel = computed(() => {
  const agentLabel = selectedAgent.value?.name ?? "No agent";
  const threadLabel =
    selectedThread.value?.name ||
    selectedThread.value?.preview ||
    props.selectedThreadId ||
    "No active thread";
  return `${agentLabel} · ${threadLabel}`;
});

function commandDisabledReason(command: string): string | null {
  if (!props.connected) {
    return "Reconnect to run commands";
  }
  if (!props.selectedAgentId) {
    return "Select an agent";
  }
  if (COMMANDS_REQUIRING_THREAD.has(command) && !props.selectedThreadId) {
    return "Select a thread";
  }
  return null;
}

const visibleCommands = computed(() => {
  const query = activeCommandQuery.value.toLowerCase();
  if (!query || query === "/") {
    return slashCommands;
  }

  const commandTerm = query.startsWith("/") ? query : `/${query}`;
  const textTerm = query.startsWith("/") ? query.slice(1) : query;

  return slashCommands.filter(
    (item) =>
      item.command.startsWith(commandTerm) ||
      item.command.slice(1).includes(textTerm) ||
      item.description.toLowerCase().includes(textTerm),
  );
});

const activeSlashCommand = computed(() => {
  const trimmed = activeCommandQuery.value;
  if (!trimmed.startsWith("/")) {
    return null;
  }
  return trimmed.split(/\s+/, 1)[0]?.toLowerCase() || null;
});

type CommandOption = {
  id: string;
  title: string;
  detail: string;
  value: string;
  action: "execute" | "fill-query";
  disabledReason?: string | null;
  contextTag?: "picker" | "run" | "disabled";
};

function parseModelCommandArgs(value: string): string[] {
  return value.trim().split(/\s+/).slice(1).filter(Boolean);
}

const modelCommandParts = computed(() =>
  parseModelCommandArgs(activeCommandQuery.value),
);

const selectedModelProviderFromDraft = computed(() => {
  if (activeSlashCommand.value !== "/model") {
    return null;
  }

  const [first] = modelCommandParts.value;
  if (!first) {
    return null;
  }

  if (first.includes("/")) {
    return first.split("/", 1)[0] || null;
  }

  return first;
});

const commandPanel = computed(() => {
  switch (activeSlashCommand.value) {
    case "/model":
      if (modelCommandParts.value[0]?.includes("/")) {
        return null;
      }

      if (!selectedModelProviderFromDraft.value) {
        return {
          title: "Choose provider",
          subtitle: "Pick provider, then model",
          options: props.modelProviders.map((provider) => ({
            id: `provider:${provider}`,
            title: provider,
            detail: "Open model list",
            value: `/model ${provider}`,
            action: "fill-query" as const,
            contextTag: "picker" as const,
          })),
        };
      }

      return {
        title: "Choose model",
        subtitle: `${selectedModelProviderFromDraft.value} · Current ${props.modelLabel || "default"}`,
        options: props.models
          .filter(
            (model) =>
              model.id.startsWith(`${selectedModelProviderFromDraft.value}/`) ||
              !model.id.includes("/"),
          )
          .slice(0, 18)
          .map((model) => ({
            id: `model:${model.id}`,
            title: model.displayName || model.id,
            detail: model.description,
            value: `/model ${model.id}`,
            action: "execute" as const,
            contextTag: "run" as const,
          })),
      };
    case "/resume":
      return {
        title: "Resume chat",
        subtitle: "Recent saved threads",
        options: props.threads.slice(0, 8).map((thread) => ({
          id: `thread:${thread.id}`,
          title: thread.name || thread.preview || thread.id,
          detail: thread.id,
          value: `/resume ${JSON.stringify(thread.name || thread.preview || thread.id).slice(1, -1)}`,
          action: "execute" as const,
          contextTag: "run" as const,
        })),
      };
    case "/agent":
    case "/subagents":
      return {
        title: "Switch agent",
        subtitle: "Available workspace agents",
        options: props.agents.slice(0, 10).map((agent) => ({
          id: `agent:${agent.id}`,
          title: agent.name,
          detail: agent.description,
          value: `${activeSlashCommand.value} ${agent.name}`,
          action: "execute" as const,
          contextTag: "run" as const,
        })),
      };
    case "/approvals":
    case "/permissions":
      return {
        title: "Permissions",
        subtitle: "Review permission and sandbox settings",
        options: [
          {
            id: "approval:show",
            title: "Show current permissions",
            detail: "Insert the command and run it",
            value: "/approvals",
            action: "execute" as const,
            contextTag: "run" as const,
          },
          {
            id: "settings:open",
            title: "Open settings",
            detail: "Adjust approval policy and sandbox defaults",
            value: "/settings",
            action: "fill-query" as const,
            contextTag: "picker" as const,
          },
        ],
      };
    case "/settings":
      return {
        title: "Quick settings",
        subtitle: `Theme ${props.theme} · Personality options`,
        options: [
          ...["system", "light", "dark"].map((theme) => ({
            id: `theme:${theme}`,
            title: `Theme ${theme}`,
            detail: theme === props.theme ? "Current theme" : "Apply theme",
            value: `/theme ${theme}`,
            action: "execute" as const,
            contextTag: "run" as const,
          })),
          ...["friendly", "pragmatic", "none"].map((personality) => ({
            id: `personality:${personality}`,
            title: `Personality ${personality}`,
            detail: "Apply personality",
            value: `/personality ${personality}`,
            action: "execute" as const,
            contextTag: "run" as const,
          })),
        ],
      };
    default:
      return null;
  }
});

const commandOptions = computed<CommandOption[]>(() => {
  if (commandPanel.value) {
    return commandPanel.value.options.map((option) => ({
      ...option,
      disabledReason: commandDisabledReason(option.value),
    }));
  }
  if (!commandControlOpen.value) {
    return [];
  }

  return visibleCommands.value.map((item) => ({
    id: item.command,
    title: item.command,
    detail: item.description,
    value: item.command,
    action: COMMAND_PANEL_PREFIXES.has(item.command) ? "fill-query" : "execute",
    disabledReason: commandDisabledReason(item.command),
    contextTag: COMMAND_PANEL_PREFIXES.has(item.command) ? "picker" : "run",
  }));
});

const highlightedCommand = computed(
  () => commandOptions.value[activeCommandIndex.value] ?? null,
);

const pendingPrompt = computed(() =>
  props.pendingRequest?.kind === "prompt" ? props.pendingRequest : null,
);

const pendingElicitation = computed(() => {
  const request = props.pendingRequest;
  if (request?.kind === "mcp-url" || request?.kind === "mcp-form") {
    return request;
  }
  return null;
});

function submit() {
  const message = draft.value.trim();
  if (!message || props.loading || !props.connected) {
    return;
  }
  emit("send", message);
  draft.value = "";
}

function applySlashCommand(command: string) {
  draft.value = command;
}

function openCommandControl(query = "") {
  commandControlOpen.value = true;
  commandControlQuery.value = query;
  activeCommandIndex.value = 0;
}

function closeCommandControl() {
  commandControlOpen.value = false;
  commandControlQuery.value = "";
  activeCommandIndex.value = 0;
}

function chooseCommandOption(option: CommandOption) {
  if (option.disabledReason) {
    return;
  }

  if (option.action === "fill-query") {
    commandControlQuery.value = option.value;
    return;
  }

  emit("send", option.value);
  closeCommandControl();
  draft.value = "";
}

function handleCommandControlKeydown(event: KeyboardEvent) {
  if (event.key === "ArrowDown") {
    if (commandOptions.value.length > 0) {
      event.preventDefault();
      activeCommandIndex.value =
        (activeCommandIndex.value + 1) % commandOptions.value.length;
    }
    return;
  }

  if (event.key === "ArrowUp") {
    if (commandOptions.value.length > 0) {
      event.preventDefault();
      activeCommandIndex.value =
        (activeCommandIndex.value - 1 + commandOptions.value.length) %
        commandOptions.value.length;
    }
    return;
  }

  if (event.key === "Escape") {
    event.preventDefault();
    closeCommandControl();
    return;
  }

  if (event.key === "Enter") {
    event.preventDefault();
    if (highlightedCommand.value) {
      chooseCommandOption(highlightedCommand.value);
    }
  }
}

function handleGlobalKeydown(event: KeyboardEvent) {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    openCommandControl("");
    return;
  }

  if (commandControlOpen.value && event.key === "Escape") {
    event.preventDefault();
    closeCommandControl();
  }
}

function handleComposerKeydown(event: KeyboardEvent) {
  if (event.isComposing) {
    return;
  }

  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    openCommandControl("");
    return;
  }

  if (
    event.key === "/" &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.altKey &&
    draft.value.trim().length === 0
  ) {
    event.preventDefault();
    openCommandControl("/");
    return;
  }

  if (event.key === "Escape") {
    if (commandControlOpen.value) {
      event.preventDefault();
      closeCommandControl();
    }
    return;
  }

  if (event.key === "Enter") {
    if (!event.shiftKey) {
      event.preventDefault();
      submit();
    }
  }
}

function resolveApproval(response: unknown) {
  emit("resolveRequest", response);
}

function submitPromptAnswers() {
  const request = pendingPrompt.value;
  if (!request) {
    return;
  }

  const answers = Object.fromEntries(
    request.questions.map((question) => [
      question.id,
      {
        answers: [promptAnswers.value[question.id] || ""].filter(Boolean),
      },
    ]),
  );
  emit("resolveRequest", { answers });
}

function fillPromptAnswer(questionId: string, value: string) {
  promptAnswers.value = {
    ...promptAnswers.value,
    [questionId]: value,
  };
}

function fillElicitationAnswer(key: string, value: string | boolean) {
  elicitationAnswers.value = {
    ...elicitationAnswers.value,
    [key]: value,
  };
}

function submitElicitation(action: "accept" | "decline" | "cancel") {
  const request = pendingElicitation.value;
  if (!request) {
    return;
  }

  if (request.kind === "mcp-url" || action !== "accept") {
    emit("resolveRequest", { action, content: null, _meta: null });
    return;
  }

  const content = Object.fromEntries(
    request.fields.map((field) => [
      field.key,
      normalizeElicitationValue(
        field.type,
        elicitationAnswers.value[field.key] ?? null,
      ),
    ]),
  );
  emit("resolveRequest", { action, content, _meta: null });
}

function submitDynamicToolResponse() {
  emit("resolveRequest", {
    contentItems: dynamicToolResult.value
      ? [{ type: "inputText", text: dynamicToolResult.value }]
      : [],
    success: dynamicToolSuccess.value,
  });
}

function normalizeElicitationValue(
  type: "text" | "number" | "boolean",
  value: string | boolean | null,
) {
  if (type === "boolean") {
    return Boolean(value);
  }
  if (type === "number") {
    if (typeof value === "string" && value.trim() !== "") {
      return Number(value);
    }
    return null;
  }
  return typeof value === "string" ? value : "";
}

function formatTokenCount(value: number) {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(0)}k`;
  }
  return String(value);
}

watch(
  () => props.selectedAgentId,
  () => {
    draft.value = "";
  },
);

watch(commandControlQuery, () => {
  activeCommandIndex.value = 0;
});

watch(
  () => props.pendingRequest,
  (request) => {
    if (request?.kind === "prompt") {
      promptAnswers.value = Object.fromEntries(
        request.questions.map((question) => [question.id, ""]),
      );
      return;
    }
    if (request?.kind === "mcp-form") {
      elicitationAnswers.value = Object.fromEntries(
        request.fields.map((field) => [field.key, field.defaultValue ?? ""]),
      ) as Record<string, string | boolean>;
      return;
    }
    if (request?.kind === "dynamic-tool") {
      dynamicToolResult.value = "";
      dynamicToolSuccess.value = true;
      return;
    }
    promptAnswers.value = {};
    elicitationAnswers.value = {};
  },
  { immediate: true },
);

watch(
  () => props.restoredDraftVersion,
  () => {
    if (props.restoredDraft === null) {
      return;
    }
    draft.value = props.restoredDraft;
  },
);

onBeforeUnmount(() => {
  window.removeEventListener("keydown", handleGlobalKeydown);
});

onMounted(() => {
  window.addEventListener("keydown", handleGlobalKeydown);
});
</script>

<template>
  <section
    class="workspace-msg-page"
    :class="{ 'is-sidebar-collapsed': sidebarCollapsed }"
    :style="workspaceColorVars"
  >
    <WorkspaceAgentList
      :agents="agents"
      :selected-agent-id="selectedAgentId"
      :search="search"
      @update-search="search = $event"
      @select="$emit('select', $event)"
    />

    <section class="workspace-msg-thread">
      <WorkspaceThreadHeader
        :selected-agent="selectedAgent"
        :selected-thread-id="selectedThreadId"
        :thread-choices="threadChoices"
        :connected="connected"
        :selected-agent-id="selectedAgentId"
        :sidebar-collapsed="sidebarCollapsed"
        @toggle-sidebar="sidebarCollapsed = !sidebarCollapsed"
        @select-thread="$emit('selectThread', $event)"
        @open-conversation="$emit('openConversation')"
      />

      <div class="workspace-msg-thread__chat">
        <WorkspacePendingRequestPanel
          :pending-request="pendingRequest"
          :prompt-answers="promptAnswers"
          :elicitation-answers="elicitationAnswers"
          :dynamic-tool-result="dynamicToolResult"
          :dynamic-tool-success="dynamicToolSuccess"
          @resolve-approval="resolveApproval"
          @reject-request="$emit('rejectRequest', $event)"
          @submit-prompt-answers="submitPromptAnswers"
          @fill-prompt-answer="fillPromptAnswer"
          @fill-elicitation-answer="fillElicitationAnswer"
          @submit-elicitation="submitElicitation"
          @set-dynamic-tool-result="dynamicToolResult = $event"
          @set-dynamic-tool-success="dynamicToolSuccess = $event"
          @submit-dynamic-tool-response="submitDynamicToolResponse"
        />

        <WorkspaceTranscriptView
          :selected-agent-id="selectedAgentId"
          :selected-thread-id="selectedThreadId"
          :committed-transcript="committedTranscript"
          :live-transcript-turn="liveTranscriptTurn"
          :active-turn-id="activeTurnId"
          :pending-user-draft="pendingUserDraft"
          :collapse-overrides="collapseOverrides"
          :status-message="statusMessage"
          :status-tone="statusTone"
          @set-collapse-override="
            (key, expanded) => $emit('setCollapseOverride', key, expanded)
          "
          @set-collapse-overrides="$emit('setCollapseOverrides', $event)"
        />

        <WorkspaceComposer
          :draft="draft"
          :connected="connected"
          :loading="loading"
          :selected-agent-id="selectedAgentId"
          :active-turn-id="activeTurnId"
          :composer-model-usage-line="composerModelUsageLine"
          :composer-meta="composerMeta"
          @update-draft="draft = $event"
          @send="submit"
          @interrupt="$emit('interrupt')"
          @attach-mention="applySlashCommand('/mention ')"
          @composer-keydown="handleComposerKeydown"
        />

        <WorkspaceCommandControl
          :open="commandControlOpen"
          :query="commandControlQuery"
          :context-label="commandContextLabel"
          :panel="commandPanel"
          :options="commandOptions"
          :active-index="activeCommandIndex"
          @close="closeCommandControl"
          @update-query="commandControlQuery = $event"
          @keydown="handleCommandControlKeydown"
          @hover="activeCommandIndex = $event"
          @choose="chooseCommandOption"
        />
      </div>
    </section>
  </section>
</template>
