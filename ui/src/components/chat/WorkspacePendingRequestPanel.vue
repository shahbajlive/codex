<script setup lang="ts">
import { computed } from "vue";
import type { WorkspacePendingRequest } from "../../stores/chat/workspace-messages";

const props = defineProps<{
  pendingRequest: WorkspacePendingRequest | null;
  promptAnswers: Record<string, string>;
  elicitationAnswers: Record<string, string | boolean>;
  dynamicToolResult: string;
  dynamicToolSuccess: boolean;
}>();

const emit = defineEmits<{
  resolveApproval: [response: unknown];
  rejectRequest: [message?: string];
  submitPromptAnswers: [];
  fillPromptAnswer: [questionId: string, value: string];
  fillElicitationAnswer: [key: string, value: string | boolean];
  submitElicitation: [action: "accept" | "decline" | "cancel"];
  setDynamicToolResult: [value: string];
  setDynamicToolSuccess: [value: boolean];
  submitDynamicToolResponse: [];
}>();

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
  if (!request) {
    return null;
  }
  return request.kind === "mcp-form" || request.kind === "mcp-url"
    ? request
    : null;
});

const pendingDynamicTool = computed(() =>
  props.pendingRequest?.kind === "dynamic-tool" ? props.pendingRequest : null,
);
</script>

<template>
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
      v-if="pendingApproval.kind === 'file-change' && pendingApproval.grantRoot"
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
        @click="emit('resolveApproval', choice.value)"
      >
        {{ choice.label }}
      </button>
    </div>
  </div>

  <form
    v-if="pendingPrompt"
    class="workspace-request workspace-request--prompt callout info"
    @submit.prevent="emit('submitPromptAnswers')"
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
        <div v-if="question.options?.length" class="workspace-request__choices">
          <button
            v-for="option in question.options"
            :key="`${question.id}:${option.label}`"
            class="btn btn--sm"
            type="button"
            @click="emit('fillPromptAnswer', question.id, option.label)"
          >
            {{ option.label }}
          </button>
        </div>
        <input
          v-if="question.isSecret"
          :value="promptAnswers[question.id] || ''"
          class="input-control workspace-request__input"
          type="password"
          @input="
            emit(
              'fillPromptAnswer',
              question.id,
              ($event.target as HTMLInputElement).value,
            )
          "
        />
        <textarea
          v-else
          :value="promptAnswers[question.id] || ''"
          class="input-control workspace-request__input"
          rows="3"
          @input="
            emit(
              'fillPromptAnswer',
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
        @click="emit('rejectRequest', 'Prompt dismissed')"
      >
        Cancel
      </button>
    </div>
  </form>

  <form
    v-if="pendingElicitation"
    class="workspace-request workspace-request--prompt callout info"
    @submit.prevent="emit('submitElicitation', 'accept')"
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
        <a :href="pendingElicitation.url" target="_blank" rel="noreferrer">
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
              emit(
                'fillElicitationAnswer',
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
          class="input-control workspace-request__input"
          type="number"
          @input="
            emit(
              'fillElicitationAnswer',
              field.key,
              ($event.target as HTMLInputElement).value,
            )
          "
        />
        <textarea
          v-else
          :value="String(elicitationAnswers[field.key] ?? '')"
          class="input-control workspace-request__input"
          rows="3"
          @input="
            emit(
              'fillElicitationAnswer',
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
        @click="emit('submitElicitation', 'decline')"
      >
        Decline
      </button>
      <button
        class="btn"
        type="button"
        @click="emit('submitElicitation', 'cancel')"
      >
        Cancel
      </button>
    </div>
  </form>

  <form
    v-if="pendingDynamicTool"
    class="workspace-request workspace-request--prompt callout warn"
    @submit.prevent="emit('submitDynamicToolResponse')"
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
      <input
        :checked="dynamicToolSuccess"
        type="checkbox"
        @change="
          emit(
            'setDynamicToolSuccess',
            ($event.target as HTMLInputElement).checked,
          )
        "
      />
      <span>Mark tool call as successful</span>
    </label>

    <textarea
      :value="dynamicToolResult"
      class="input-control workspace-request__input"
      rows="4"
      placeholder="Enter text content returned by the tool."
      @input="
        emit(
          'setDynamicToolResult',
          ($event.target as HTMLTextAreaElement).value,
        )
      "
    />

    <div class="workspace-request__actions">
      <button class="btn primary" type="submit">Send tool result</button>
      <button
        class="btn"
        type="button"
        @click="emit('rejectRequest', 'Tool call cancelled')"
      >
        Cancel
      </button>
    </div>
  </form>
</template>
