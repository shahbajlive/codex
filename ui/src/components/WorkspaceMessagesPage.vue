<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { Model, Thread, ThreadTokenUsage } from "../lib/protocol";
import { slashCommands } from "../lib/slash-commands";
import {
  liveTranscriptItemStatus,
  liveTranscriptItemTitle,
  liveTurnStatusLabel,
  renderTranscriptItem,
  transcriptTurnStatusLabel,
  transcriptTurnTone,
  transcriptItemTitle,
  type LiveTranscriptItem,
  type LiveTranscriptTurn,
  type TranscriptItem,
  type TranscriptTurn,
} from "../lib/transcript";
import { formatTime, truncate } from "../lib/format";
import type {
  WorkspaceAgentRow,
  WorkspacePendingRequest,
} from "../stores/chat/workspace-messages";

const props = defineProps<{
  approvalPolicy: string;
  autoCompactTokenLimit: number | null;
  loading: boolean;
  connected: boolean;
  contextWindow: number | null;
  agents: WorkspaceAgentRow[];
  modelLabel: string;
  models: Model[];
  pendingRequest: WorkspacePendingRequest | null;
  personality: string;
  restoredDraft: string | null;
  restoredDraftVersion: number;
  sandboxMode: string;
  statusMessage: string | null;
  statusTone: "info" | "warning" | "error" | null;
  activeTurnId: string | null;
  committedTranscript: TranscriptTurn[];
  liveTranscriptTurn: LiveTranscriptTurn | null;
  selectedAgentId: string | null;
  selectedModelProvider: string | null;
  selectedThreadId: string | null;
  selectedTokenUsage: ThreadTokenUsage | null;
  theme: string;
  threads: Thread[];
}>();

const emit = defineEmits<{
  refresh: [];
  rejectRequest: [message?: string];
  resolveRequest: [response: unknown];
  select: [threadId: string];
  send: [message: string];
  interrupt: [];
  openConversation: [];
}>();

const draft = ref("");
const search = ref("");
const sidebarCollapsed = ref(false);
const promptAnswers = ref<Record<string, string>>({});
const elicitationAnswers = ref<Record<string, string | boolean>>({});
const dynamicToolResult = ref("");
const dynamicToolSuccess = ref(true);
const composerField = ref<HTMLTextAreaElement | null>(null);
const activeCommandIndex = ref(0);
const settlingLiveTurn = ref<LiveTranscriptTurn | null>(null);
let settlingLiveTurnTimer: ReturnType<typeof setTimeout> | null = null;

const selectedAgent = computed(
  () =>
    props.agents.find((agent) => agent.id === props.selectedAgentId) ?? null,
);

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

const composerMeta = computed(() => [
  props.modelLabel ? `Model ${props.modelLabel}` : null,
  props.selectedModelProvider
    ? `Provider ${props.selectedModelProvider}`
    : null,
  props.selectedTokenUsage
    ? `Tokens ${formatTokenCount(props.selectedTokenUsage.total.totalTokens)}`
    : null,
  props.selectedTokenUsage
    ? `Last ${formatTokenCount(props.selectedTokenUsage.last.totalTokens)}`
    : null,
  props.contextWindow
    ? `Window ${formatTokenCount(props.contextWindow)}`
    : null,
  props.autoCompactTokenLimit
    ? `Auto-compact ${formatTokenCount(props.autoCompactTokenLimit)}`
    : null,
]);

const statusBannerMessage = computed(() => {
  if (props.liveTranscriptTurn) {
    return null;
  }

  return props.statusMessage || (props.activeTurnId ? "Working" : null);
});

const hasTranscriptContent = computed(
  () =>
    displayedCommittedTranscript.value.length > 0 ||
    activeOrSettlingLiveTurn.value !== null,
);

const activeOrSettlingLiveTurn = computed(
  () => props.liveTranscriptTurn ?? settlingLiveTurn.value,
);

const settlingLiveTone = computed(() => {
  const turn = activeOrSettlingLiveTurn.value;
  if (!turn || props.liveTranscriptTurn) {
    return null;
  }

  switch (turn.status) {
    case "failed":
      return "error";
    case "interrupted":
      return "warning";
    default:
      return "muted";
  }
});

const settlingLiveLabel = computed(() => {
  const turn = activeOrSettlingLiveTurn.value;
  if (!turn || props.liveTranscriptTurn) {
    return null;
  }

  switch (turn.status) {
    case "failed":
      return "Failed turn";
    case "interrupted":
      return "Interrupted turn";
    case "completed":
      return "Completed turn";
    default:
      return "Settling turn";
  }
});

const displayedCommittedTranscript = computed(() => {
  const hiddenTurnId = activeOrSettlingLiveTurn.value?.id;
  if (!hiddenTurnId) {
    return props.committedTranscript;
  }

  return props.committedTranscript.filter((turn) => turn.id !== hiddenTurnId);
});

const showCommandMenu = computed(() => draft.value.trimStart().startsWith("/"));

const visibleCommands = computed(() => {
  const query = draft.value.trim().toLowerCase();
  if (!query || query === "/") {
    return slashCommands;
  }
  return slashCommands.filter(
    (item) =>
      item.command.startsWith(query) ||
      item.description.toLowerCase().includes(query.slice(1)),
  );
});

const activeSlashCommand = computed(() => {
  const trimmed = draft.value.trim();
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
};

const commandPanel = computed(() => {
  switch (activeSlashCommand.value) {
    case "/model":
      return {
        title: "Choose model",
        subtitle: `Current ${props.modelLabel || "default"}`,
        options: props.models.slice(0, 12).map((model) => ({
          id: `model:${model.id}`,
          title: model.displayName || model.id,
          detail: model.description,
          value: `/model ${model.id}`,
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
        })),
      };
    case "/approvals":
    case "/permissions":
      return {
        title: "Permissions",
        subtitle: `Current ${props.approvalPolicy} · ${props.sandboxMode}`,
        options: [
          {
            id: "approval:show",
            title: "Show current permissions",
            detail: "Insert the command and run it",
            value: "/approvals",
          },
          {
            id: "settings:open",
            title: "Open settings",
            detail: "Adjust approval policy and sandbox defaults",
            value: "/settings",
          },
        ],
      };
    case "/settings":
      return {
        title: "Quick settings",
        subtitle: `Theme ${props.theme} · Personality ${props.personality}`,
        options: [
          ...["system", "light", "dark"].map((theme) => ({
            id: `theme:${theme}`,
            title: `Theme ${theme}`,
            detail: theme === props.theme ? "Current theme" : "Apply theme",
            value: `/theme ${theme}`,
          })),
          ...["friendly", "pragmatic", "none"].map((personality) => ({
            id: `personality:${personality}`,
            title: `Personality ${personality}`,
            detail:
              personality === props.personality
                ? "Current personality"
                : "Apply personality",
            value: `/personality ${personality}`,
          })),
        ],
      };
    default:
      return null;
  }
});

const commandOptions = computed<CommandOption[]>(() => {
  if (commandPanel.value) {
    return commandPanel.value.options;
  }
  if (!showCommandMenu.value) {
    return [];
  }
  return visibleCommands.value.map((item) => ({
    id: item.command,
    title: item.command,
    detail: item.description,
    value: item.command,
  }));
});

const highlightedCommand = computed(
  () => commandOptions.value[activeCommandIndex.value] ?? null,
);

const pendingApproval = computed(() => {
  const request = props.pendingRequest;
  if (
    request?.kind === "command" ||
    request?.kind === "file-change" ||
    request?.kind === "permissions"
  ) {
    return request;
  }
  return null;
});

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

const pendingDynamicTool = computed(() =>
  props.pendingRequest?.kind === "dynamic-tool" ? props.pendingRequest : null,
);

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
  resizeComposer();
  composerField.value?.focus();
}

function chooseCommandOption(value: string) {
  applySlashCommand(value);
}

function handleComposerKeydown(event: KeyboardEvent) {
  if (event.isComposing) {
    return;
  }

  const hasMenu = commandOptions.value.length > 0;

  if (hasMenu) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      activeCommandIndex.value =
        (activeCommandIndex.value + 1) % commandOptions.value.length;
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      activeCommandIndex.value =
        (activeCommandIndex.value - 1 + commandOptions.value.length) %
        commandOptions.value.length;
      return;
    }
  }

  if (event.key === "Escape") {
    if (draft.value.startsWith("/")) {
      event.preventDefault();
      draft.value = "";
      activeCommandIndex.value = 0;
    }
    return;
  }

  if (event.key === "Enter") {
    if (hasMenu) {
      const exactCommand = slashCommands.some(
        (item) => item.command === draft.value.trim(),
      );
      if (showCommandMenu.value || commandPanel.value || exactCommand) {
        event.preventDefault();
        if (highlightedCommand.value) {
          chooseCommandOption(highlightedCommand.value.value);
        }
        return;
      }
    }

    if (!event.shiftKey) {
      event.preventDefault();
      submit();
    }
  }
}

function bubbleClass(item: TranscriptItem | LiveTranscriptItem) {
  if (item.kind === "user") {
    return "bubble bubble--user";
  }
  if (item.kind === "assistant") {
    return "bubble bubble--assistant";
  }
  if (item.kind === "event") {
    return `bubble bubble--event bubble--event-${item.tone}`;
  }
  return "bubble bubble--activity";
}

function liveBubbleClass(item: LiveTranscriptItem) {
  return `${bubbleClass(item)} bubble--live`;
}

function committedTurnClass(turn: TranscriptTurn) {
  const tone = transcriptTurnTone(turn);
  return {
    "turn-stack--warning": tone === "warning",
    "turn-stack--error": tone === "error",
  };
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

function resizeComposer() {
  if (!composerField.value) {
    return;
  }
  composerField.value.style.height = "auto";
  composerField.value.style.height = `${Math.min(composerField.value.scrollHeight, 132)}px`;
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
    resizeComposer();
  },
);

watch(draft, () => {
  resizeComposer();
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
    resizeComposer();
    composerField.value?.focus();
  },
);

watch(
  () => props.liveTranscriptTurn,
  (next, previous) => {
    if (settlingLiveTurnTimer) {
      clearTimeout(settlingLiveTurnTimer);
      settlingLiveTurnTimer = null;
    }

    if (next) {
      settlingLiveTurn.value = null;
      return;
    }

    if (!previous) {
      settlingLiveTurn.value = null;
      return;
    }

    settlingLiveTurn.value = previous;
    settlingLiveTurnTimer = setTimeout(() => {
      settlingLiveTurn.value = null;
      settlingLiveTurnTimer = null;
    }, 450);
  },
);
</script>

<template>
  <section
    class="workspace-msg-page"
    :class="{ 'is-sidebar-collapsed': sidebarCollapsed }"
  >
    <aside class="workspace-msg-page__sidebar">
      <section class="workspace-msg-list">
        <div class="workspace-msg-list__header">
          <div class="card-title">Messages</div>
          <!--          <div class="card-sub">Workspace agent inbox</div>-->
        </div>

        <label class="workspace-msg-search field">
          <div class="workspace-msg-search__control">
            <span class="workspace-msg-search__icon" aria-hidden="true">
              <svg viewBox="0 0 16 16" fill="none">
                <circle
                  cx="7"
                  cy="7"
                  r="4.5"
                  stroke="currentColor"
                  stroke-width="1.5"
                />
                <path
                  d="M10.5 10.5L13 13"
                  stroke="currentColor"
                  stroke-width="1.5"
                  stroke-linecap="round"
                />
              </svg>
            </span>
            <input v-model="search" placeholder="Search agents..." />
            <button
              v-if="search.trim()"
              class="workspace-msg-search__clear"
              type="button"
              aria-label="Clear search"
              @click="search = ''"
            >
              <svg viewBox="0 0 16 16" fill="none">
                <path
                  d="M4 4l8 8M12 4l-8 8"
                  stroke="currentColor"
                  stroke-width="1.5"
                  stroke-linecap="round"
                />
              </svg>
            </button>
          </div>
        </label>

        <div class="workspace-msg-list__items">
          <button
            v-for="agent in filteredAgents"
            :key="agent.id"
            class="workspace-msg-list__item nav-item"
            :class="{ 'active is-selected': agent.id === selectedAgentId }"
            @click="$emit('select', agent.id)"
          >
            <div class="workspace-msg-list__avatar">
              <span>{{ agent.name.slice(0, 1) }}</span>
            </div>
            <div class="workspace-msg-list__meta">
              <div class="workspace-msg-list__row">
                <span class="workspace-msg-list__name nav-item__text">{{
                  agent.name
                }}</span>
                <span class="workspace-msg-list__time muted">
                  {{
                    agent.hasThread
                      ? formatTime(agent.updatedAt) || "active"
                      : "new"
                  }}
                </span>
              </div>
              <div class="workspace-msg-list__preview muted">
                {{
                  truncate(agent.preview || agent.description || agent.id, 60)
                }}
              </div>
            </div>
          </button>
        </div>
      </section>
    </aside>

    <section class="workspace-msg-thread">
      <header class="workspace-msg-thread__header">
        <button class="workspace-msg-thread__agent" type="button">
          <div class="workspace-msg-thread__avatar">
            {{ selectedAgent ? selectedAgent.name.slice(0, 1) : "?" }}
          </div>
          <div>
            <div class="workspace-msg-thread__name">
              {{ selectedAgent ? selectedAgent.name : "Select an agent" }}
            </div>
            <div class="workspace-msg-thread__title">
              <!--              TODO: show status or active thread -->
              {{}}
            </div>
          </div>
        </button>

        <div class="workspace-msg-thread__actions">
          <button
            class="workspace-msg-thread__icon-btn"
            type="button"
            :title="
              sidebarCollapsed
                ? 'Expand conversations'
                : 'Collapse conversations'
            "
            :aria-label="sidebarCollapsed ? 'Expand' : 'Collapse'"
            @click="sidebarCollapsed = !sidebarCollapsed"
          >
            <svg viewBox="0 0 16 16" fill="none">
              <path
                v-if="sidebarCollapsed"
                d="M6 4l4 4-4 4"
                stroke="currentColor"
                stroke-width="1.5"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
              <path
                v-else
                d="M10 4L6 8l4 4"
                stroke="currentColor"
                stroke-width="1.5"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </button>
          <span
            class="statusDot"
            :class="{ ok: connected }"
            :title="connected ? 'Connected' : 'Disconnected'"
            aria-hidden="true"
          />
          <button
            v-if="selectedAgentId && selectedThreadId"
            class="workspace-msg-thread__icon-btn"
            type="button"
            title="Open in chat"
            aria-label="Open in chat"
            @click="$emit('openConversation')"
          >
            <svg viewBox="0 0 16 16" fill="none">
              <path
                d="M3 3h7v7M10 3l3 3-3 3"
                stroke="currentColor"
                stroke-width="1.5"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </button>
        </div>
      </header>

      <div class="workspace-msg-thread__chat">
        <div v-if="pendingApproval" class="workspace-request callout warn">
          <div class="workspace-request__header">
            <div>
              <div class="note-title">{{ pendingApproval.title }}</div>
              <div v-if="pendingApproval.reason" class="card-sub">
                {{ pendingApproval.reason }}
              </div>
            </div>
            <span class="agent-pill warn">Action needed</span>
          </div>

          <pre
            v-if="pendingApproval.kind === 'command' && pendingApproval.command"
            class="workspace-request__body code-block"
            >{{ pendingApproval.command }}</pre
          >
          <div
            v-if="pendingApproval.kind === 'command' && pendingApproval.cwd"
            class="workspace-request__meta muted"
          >
            Working directory:
            <span class="mono">{{ pendingApproval.cwd }}</span>
          </div>
          <div
            v-if="
              pendingApproval.kind === 'file-change' &&
              pendingApproval.grantRoot
            "
            class="workspace-request__meta muted"
          >
            Requested root:
            <span class="mono">{{ pendingApproval.grantRoot }}</span>
          </div>
          <div
            v-if="pendingApproval.kind === 'permissions'"
            class="workspace-request__list"
          >
            <div
              v-for="entry in pendingApproval.permissionSummary"
              :key="entry"
              class="workspace-request__list-item"
            >
              {{ entry }}
            </div>
          </div>

          <div class="workspace-request__actions">
            <button
              v-for="choice in pendingApproval.choices"
              :key="choice.label"
              class="btn"
              :class="choice.label.startsWith('Allow') ? 'primary' : ''"
              @click="resolveApproval(choice.value)"
            >
              {{ choice.label }}
            </button>
          </div>
        </div>

        <form
          v-if="pendingPrompt"
          class="workspace-request workspace-request--prompt callout info"
          @submit.prevent="submitPromptAnswers"
        >
          <div class="workspace-request__header">
            <div>
              <div class="note-title">{{ pendingPrompt.title }}</div>
              <div class="card-sub">The agent is waiting for your answer.</div>
            </div>
            <span class="agent-pill">Input needed</span>
          </div>

          <div class="workspace-request__questions">
            <div
              v-for="question in pendingPrompt.questions"
              :key="question.id"
              class="workspace-request__question"
            >
              <label class="label workspace-request__question-title">{{
                question.header
              }}</label>
              <div class="card-sub workspace-request__question-copy">
                {{ question.question }}
              </div>
              <div
                v-if="question.options?.length"
                class="workspace-request__choices"
              >
                <button
                  v-for="option in question.options"
                  :key="`${question.id}:${option.label}`"
                  class="btn btn--sm"
                  type="button"
                  @click="fillPromptAnswer(question.id, option.label)"
                >
                  {{ option.label }}
                </button>
              </div>
              <input
                v-if="question.isSecret"
                :value="promptAnswers[question.id] || ''"
                class="field workspace-request__input"
                type="password"
                @input="
                  fillPromptAnswer(
                    question.id,
                    ($event.target as HTMLInputElement).value,
                  )
                "
              />
              <textarea
                v-else
                :value="promptAnswers[question.id] || ''"
                class="field workspace-request__input"
                rows="3"
                @input="
                  fillPromptAnswer(
                    question.id,
                    ($event.target as HTMLTextAreaElement).value,
                  )
                "
              />
            </div>
          </div>

          <div class="workspace-request__actions">
            <button class="btn primary" type="submit">Submit answers</button>
            <button
              class="btn"
              type="button"
              @click="$emit('rejectRequest', 'Prompt dismissed')"
            >
              Cancel
            </button>
          </div>
        </form>

        <form
          v-if="pendingElicitation"
          class="workspace-request workspace-request--prompt callout info"
          @submit.prevent="submitElicitation('accept')"
        >
          <div class="workspace-request__header">
            <div>
              <div class="note-title">{{ pendingElicitation.title }}</div>
              <div class="card-sub">{{ pendingElicitation.message }}</div>
            </div>
            <span class="agent-pill">MCP</span>
          </div>

          <div
            v-if="pendingElicitation.kind === 'mcp-url'"
            class="workspace-request__question"
          >
            <div class="workspace-request__meta muted">
              Open this URL to continue:
              <a
                :href="pendingElicitation.url"
                target="_blank"
                rel="noreferrer"
              >
                {{ pendingElicitation.url }}
              </a>
            </div>
          </div>

          <div v-else class="workspace-request__questions">
            <div
              v-for="field in pendingElicitation.fields"
              :key="field.key"
              class="workspace-request__question"
            >
              <label class="label workspace-request__question-title">
                {{ field.label }}
                <span v-if="field.required">*</span>
              </label>
              <div
                v-if="field.description"
                class="card-sub workspace-request__question-copy"
              >
                {{ field.description }}
              </div>
              <label
                v-if="field.type === 'boolean'"
                class="row workspace-request__toggle-row"
              >
                <input
                  :checked="Boolean(elicitationAnswers[field.key])"
                  type="checkbox"
                  @change="
                    fillElicitationAnswer(
                      field.key,
                      ($event.target as HTMLInputElement).checked,
                    )
                  "
                />
                <span>Enabled</span>
              </label>
              <input
                v-else-if="field.type === 'number'"
                :value="String(elicitationAnswers[field.key] ?? '')"
                class="workspace-request__input"
                type="number"
                @input="
                  fillElicitationAnswer(
                    field.key,
                    ($event.target as HTMLInputElement).value,
                  )
                "
              />
              <textarea
                v-else
                :value="String(elicitationAnswers[field.key] ?? '')"
                class="workspace-request__input"
                rows="3"
                @input="
                  fillElicitationAnswer(
                    field.key,
                    ($event.target as HTMLTextAreaElement).value,
                  )
                "
              />
            </div>
          </div>

          <div class="workspace-request__actions">
            <button class="btn primary" type="submit">Accept</button>
            <button
              class="btn"
              type="button"
              @click="submitElicitation('decline')"
            >
              Decline
            </button>
            <button
              class="btn"
              type="button"
              @click="submitElicitation('cancel')"
            >
              Cancel
            </button>
          </div>
        </form>

        <form
          v-if="pendingDynamicTool"
          class="workspace-request workspace-request--prompt callout warn"
          @submit.prevent="submitDynamicToolResponse"
        >
          <div class="workspace-request__header">
            <div>
              <div class="note-title">{{ pendingDynamicTool.title }}</div>
              <div class="card-sub">
                Return a manual result for this client-side tool call.
              </div>
            </div>
            <span class="agent-pill warn">Tool call</span>
          </div>

          <pre class="workspace-request__body code-block">{{
            pendingDynamicTool.argumentsJson
          }}</pre>

          <label class="row workspace-request__toggle-row">
            <input v-model="dynamicToolSuccess" type="checkbox" />
            <span>Mark tool call as successful</span>
          </label>

          <textarea
            v-model="dynamicToolResult"
            class="workspace-request__input"
            rows="4"
            placeholder="Enter text content returned by the tool."
          />

          <div class="workspace-request__actions">
            <button class="btn primary" type="submit">Send tool result</button>
            <button
              class="btn"
              type="button"
              @click="$emit('rejectRequest', 'Tool call cancelled')"
            >
              Cancel
            </button>
          </div>
        </form>

        <div v-if="hasTranscriptContent" class="workspace-chat__body">
          <div
            v-for="turn in displayedCommittedTranscript"
            :key="turn.id"
            class="turn-stack"
            :class="committedTurnClass(turn)"
          >
            <div class="turn-meta">
              <span>Turn {{ turn.id.slice(0, 8) }}</span>
              <span class="turn-meta__status">{{
                transcriptTurnStatusLabel(turn)
              }}</span>
              <span v-if="turn.error" class="turn-meta__error">{{
                turn.error
              }}</span>
            </div>
            <div
              v-for="item in turn.items"
              :key="item.id"
              :class="bubbleClass(item)"
            >
              <div v-if="transcriptItemTitle(item)" class="bubble__title">
                {{ transcriptItemTitle(item) }}
                <span v-if="'status' in item" class="bubble__status">{{
                  item.status
                }}</span>
              </div>
              <pre class="bubble__body">{{ renderTranscriptItem(item) }}</pre>
            </div>
          </div>

          <section
            v-if="activeOrSettlingLiveTurn"
            class="workspace-chat__live-turn"
            :class="{
              'workspace-chat__live-turn--settling': !liveTranscriptTurn,
              'workspace-chat__live-turn--settling-error':
                settlingLiveTone === 'error',
              'workspace-chat__live-turn--settling-warning':
                settlingLiveTone === 'warning',
            }"
          >
            <div class="workspace-chat__live-turn-header">
              <span class="workspace-chat__live-turn-label">Live turn</span>
              <span class="workspace-chat__live-turn-id">
                Turn {{ activeOrSettlingLiveTurn.id.slice(0, 8) }}
              </span>
            </div>

            <div
              v-if="settlingLiveLabel"
              class="workspace-chat__live-turn-settling"
              :class="[
                settlingLiveTone
                  ? `workspace-chat__live-turn-settling--${settlingLiveTone}`
                  : '',
              ]"
            >
              {{ settlingLiveLabel }}
            </div>

            <div
              v-if="activeOrSettlingLiveTurn.events.length > 0"
              class="workspace-chat__live-events"
            >
              <div
                v-for="event in activeOrSettlingLiveTurn.events"
                :key="event.id"
                :class="[
                  'bubble',
                  'bubble--event',
                  `bubble--event-${event.tone}`,
                  'bubble--live',
                ]"
              >
                <div class="bubble__title">{{ event.label }}</div>
                <pre class="bubble__body">{{ event.detail }}</pre>
              </div>
            </div>

            <div class="turn-stack turn-stack--live">
              <div class="turn-meta">
                <span>{{ liveTurnStatusLabel(activeOrSettlingLiveTurn) }}</span>
                <span
                  v-if="activeOrSettlingLiveTurn.error"
                  class="turn-meta__error"
                >
                  {{ activeOrSettlingLiveTurn.error }}
                </span>
              </div>
              <div
                v-for="item in activeOrSettlingLiveTurn.items"
                :key="item.id"
                :class="liveBubbleClass(item)"
              >
                <div v-if="liveTranscriptItemTitle(item)" class="bubble__title">
                  {{ liveTranscriptItemTitle(item) }}
                  <span
                    v-if="liveTranscriptItemStatus(item)"
                    class="bubble__status"
                    >{{ liveTranscriptItemStatus(item) }}</span
                  >
                </div>
                <pre class="bubble__body">{{ renderTranscriptItem(item) }}</pre>
              </div>
            </div>
          </section>
        </div>
        <div v-else class="workspace-chat__empty">
          {{
            selectedAgentId
              ? "No transcript loaded for this agent yet."
              : "Select an agent on the left to view its transcript."
          }}
        </div>

        <div
          v-if="statusBannerMessage"
          :class="[
            'banner',
            'workspace-chat__status',
            statusTone ? `workspace-chat__status--${statusTone}` : '',
          ]"
        >
          {{ statusBannerMessage }}
        </div>

        <form class="workspace-chat__composer" @submit.prevent="submit">
          <div
            v-if="commandOptions.length > 0"
            class="workspace-chat__command-menu"
          >
            <div v-if="commandPanel" class="workspace-chat__command-panel-head">
              <div class="workspace-chat__command-panel-title">
                {{ commandPanel.title }}
              </div>
              <div class="workspace-chat__command-panel-subtitle">
                {{ commandPanel.subtitle }}
              </div>
            </div>
            <button
              v-for="(item, index) in commandOptions"
              :key="item.id"
              class="workspace-chat__command-item"
              :class="{ 'is-active': index === activeCommandIndex }"
              type="button"
              @mouseenter="activeCommandIndex = index"
              @click="chooseCommandOption(item.value)"
            >
              <span class="workspace-chat__command-name">{{ item.title }}</span>
              <span class="workspace-chat__command-copy">{{
                item.detail
              }}</span>
            </button>
          </div>
          <div class="workspace-chat__composer-row">
            <button
              class="workspace-chat__composer-icon"
              type="button"
              title="Available commands"
              aria-label="Commands"
              @click="applySlashCommand('/')"
            >
              <svg viewBox="0 0 16 16" fill="none">
                <path
                  d="M3 4h10"
                  stroke="currentColor"
                  stroke-width="1.5"
                  stroke-linecap="round"
                />
                <path
                  d="M3 8h7"
                  stroke="currentColor"
                  stroke-width="1.5"
                  stroke-linecap="round"
                />
                <path
                  d="M3 12h5"
                  stroke="currentColor"
                  stroke-width="1.5"
                  stroke-linecap="round"
                />
                <circle
                  cx="12"
                  cy="12"
                  r="2.5"
                  stroke="currentColor"
                  stroke-width="1.25"
                />
              </svg>
            </button>
            <div class="workspace-chat__composer-field">
              <textarea
                ref="composerField"
                v-model="draft"
                rows="1"
                :disabled="!connected || !selectedAgentId"
                placeholder="Message the selected workspace agent..."
                @keydown="handleComposerKeydown"
              />
            </div>
            <button
              v-if="activeTurnId"
              class="workspace-chat__composer-icon"
              type="button"
              title="Interrupt turn"
              aria-label="Interrupt turn"
              @click="$emit('interrupt')"
            >
              <svg viewBox="0 0 16 16" fill="none">
                <rect
                  x="4"
                  y="4"
                  width="8"
                  height="8"
                  rx="1.5"
                  stroke="currentColor"
                  stroke-width="1.5"
                />
              </svg>
            </button>
            <button
              class="workspace-chat__composer-send"
              type="submit"
              title="Send message"
              aria-label="Send message"
              :disabled="loading || !connected || !selectedAgentId"
            >
              <svg viewBox="0 0 16 16" fill="none">
                <path
                  d="M14 2L2 7l5 2.5L9 14l2-5L14 2z"
                  stroke="currentColor"
                  stroke-width="1.5"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
            </button>
          </div>
          <div class="workspace-chat__composer-meta">
            <span
              v-for="entry in composerMeta.filter(Boolean)"
              :key="entry || ''"
              class="workspace-chat__composer-meta-chip"
            >
              {{ entry }}
            </span>
          </div>
        </form>
      </div>
    </section>
  </section>
</template>
