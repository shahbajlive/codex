<script setup lang="ts">
import { ref } from "vue";
import type { Thread } from "../lib/protocol";
import type { TranscriptTurn } from "../lib/transcript";
import { agentDisplayName, agentRoleLabel, agentTypeLabel } from "../lib/agents";
import { formatThreadStatus, truncate } from "../lib/format";

const activePanel = ref<"overview" | "files" | "tools" | "skills" | "channels" | "cron">(
  "overview",
);

defineProps<{
  loading: boolean;
  agents: Thread[];
  selectedAgentId: string | null;
  selectedAgent: Thread | null;
  transcript: TranscriptTurn[];
}>();

const emit = defineEmits<{
  refresh: [];
  select: [threadId: string];
  openConversation: [threadId: string];
}>();

const panels = [
  { id: "overview", label: "Overview" },
  { id: "files", label: "Files" },
  { id: "tools", label: "Tools" },
  { id: "skills", label: "Skills" },
  { id: "channels", label: "Channels" },
  { id: "cron", label: "Cron Jobs" },
] as const;
</script>

<template>
  <section class="agents-layout">
    <aside class="card agents-sidebar">
      <div class="row row--spread">
        <div>
          <div class="card-title">Agents</div>
          <div class="card-sub">{{ agents.length }} configured.</div>
        </div>
        <button class="btn btn--sm" @click="emit('refresh')">
          {{ loading ? "Loading..." : "Refresh" }}
        </button>
      </div>

      <div class="agent-list">
        <button
          v-for="agent in agents"
          :key="agent.id"
          class="agent-row"
          :class="{ active: agent.id === selectedAgentId }"
          @click="emit('select', agent.id)"
        >
          <div class="agent-avatar">
            {{ agent.agentNickname?.slice(0, 1) || agentDisplayName(agent).slice(0, 1) }}
          </div>
          <div class="agent-info">
            <div class="agent-title">{{ agentDisplayName(agent) }}</div>
            <div class="agent-sub mono">{{ agent.id }}</div>
          </div>
          <span v-if="agent.id === selectedAgentId" class="agent-pill">default</span>
        </button>
      </div>
    </aside>

    <section class="agents-main">
      <template v-if="selectedAgent">
        <section class="card agent-header">
          <div class="agent-header-main">
            <div class="agent-avatar agent-avatar--lg">
              {{
                selectedAgent.agentNickname?.slice(0, 1) ||
                agentDisplayName(selectedAgent).slice(0, 1)
              }}
            </div>
            <div>
              <div class="card-title">{{ agentDisplayName(selectedAgent) }}</div>
              <div class="card-sub">
                {{ truncate(selectedAgent.preview || "Agent workspace and routing.", 140) }}
              </div>
            </div>
          </div>
          <div class="agent-header-meta">
            <div class="mono">{{ selectedAgent.id }}</div>
            <span class="agent-pill">default</span>
          </div>
        </section>

        <div class="agent-tabs">
          <button
            v-for="panel in panels"
            :key="panel.id"
            class="agent-tab"
            :class="{ active: activePanel === panel.id }"
            type="button"
            @click="activePanel = panel.id"
          >
            {{ panel.label }}
          </button>
        </div>

        <section v-if="activePanel === 'overview'" class="card">
          <div class="card-title">Overview</div>
          <div class="card-sub">Workspace paths and identity metadata.</div>

          <div class="agents-overview-grid mt-6">
            <div class="agent-kv">
              <div class="card-sub">Workspace</div>
              <div class="mono">{{ selectedAgent.cwd || "Unavailable" }}</div>
            </div>
            <div class="agent-kv">
              <div class="card-sub">Primary Model</div>
              <div class="mono">{{ selectedAgent.modelProvider || "default" }}</div>
            </div>
            <div class="agent-kv">
              <div class="card-sub">Identity Name</div>
              <div>{{ agentDisplayName(selectedAgent) }}</div>
            </div>
            <div class="agent-kv">
              <div class="card-sub">Default</div>
              <div>{{ selectedAgentId === selectedAgent.id ? "yes" : "no" }}</div>
            </div>
            <div class="agent-kv">
              <div class="card-sub">Role</div>
              <div>{{ agentRoleLabel(selectedAgent) }}</div>
            </div>
            <div class="agent-kv">
              <div class="card-sub">Type</div>
              <div>{{ agentTypeLabel(selectedAgent) }}</div>
            </div>
            <div class="agent-kv">
              <div class="card-sub">Status</div>
              <div>{{ formatThreadStatus(selectedAgent.status) }}</div>
            </div>
            <div class="agent-kv">
              <div class="card-sub">Preview</div>
              <div class="agent-kv-sub">
                {{ truncate(selectedAgent.preview || "No preview yet.", 180) }}
              </div>
            </div>
          </div>

          <div class="row row--spread mt-6">
            <div class="card-sub">Open this isolated thread in the chat workspace.</div>
            <button class="btn primary" @click="emit('openConversation', selectedAgent.id)">
              Open Conversation
            </button>
          </div>
        </section>

        <section v-else-if="activePanel === 'files'" class="card">
          <div class="card-title">Files</div>
          <div class="card-sub">File browsing for Codex subagents will land here next.</div>
        </section>

        <section v-else-if="activePanel === 'tools'" class="card">
          <div class="card-title">Tools</div>
          <div class="card-sub">Tool permissions and tool activity are next in line for parity.</div>
        </section>

        <section v-else-if="activePanel === 'skills'" class="card">
          <div class="card-title">Skills</div>
          <div class="card-sub">Installed skills and toggles will appear in this panel.</div>
        </section>

        <section v-else-if="activePanel === 'channels'" class="card">
          <div class="card-title">Channels</div>
          <div class="card-sub">Delivery channels are not wired for Codex yet.</div>
        </section>

        <section v-else class="card">
          <div class="card-title">Cron Jobs</div>
          <div class="card-sub">Scheduled automation parity is still to come.</div>
        </section>

        <section class="card">
          <div class="card-title">Transcript</div>
          <div class="card-sub">Recent activity from the selected thread.</div>

          <div v-if="transcript.length > 0" class="mt-4 flex max-h-[34rem] flex-col gap-5 overflow-auto">
            <div v-for="turn in transcript" :key="turn.id" class="flex flex-col gap-2.5">
              <div class="flex items-center justify-between gap-3 text-xs uppercase tracking-[0.1em] text-[var(--muted)]">
                <span>Turn {{ turn.id.slice(0, 8) }}</span>
                <span>{{ turn.status }}</span>
              </div>
              <div
                v-for="item in turn.items"
                :key="item.id"
                class="rounded-3xl border px-4 py-3.5"
                :style="
                  item.kind === 'assistant'
                    ? {
                        borderColor: 'color-mix(in srgb, var(--border-strong) 28%, transparent)',
                        background: 'color-mix(in srgb, var(--bg-elevated) 86%, transparent)',
                        color: 'var(--chat-text)',
                      }
                    : item.kind === 'activity'
                      ? {
                          borderColor: 'color-mix(in srgb, var(--accent-2) 26%, transparent)',
                          background: 'color-mix(in srgb, var(--accent-2-subtle) 85%, var(--bg-elevated))',
                          color: 'var(--text)',
                        }
                      : {
                          borderColor: 'color-mix(in srgb, var(--accent) 46%, transparent)',
                          background:
                            'linear-gradient(180deg, color-mix(in srgb, var(--accent) 86%, #ffffff), color-mix(in srgb, var(--accent) 78%, #000000))',
                          color: 'var(--accent-foreground)',
                        }
                "
              >
                <div v-if="item.kind === 'activity'" class="mb-2 text-sm font-semibold text-[var(--accent-2)]">
                  {{ item.label }}
                </div>
                <pre>{{ item.kind === "activity" ? item.detail : item.text }}</pre>
              </div>
            </div>
          </div>
          <div v-else class="mt-4 text-sm text-[var(--muted)]">
            No transcript loaded for this agent yet.
          </div>
        </section>
      </template>

      <div v-else class="card">
        <div class="card-title">Select an agent</div>
        <div class="card-sub">Pick an agent to inspect its workspace and tools.</div>
      </div>
    </section>
  </section>
</template>
