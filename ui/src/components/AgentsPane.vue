<script setup lang="ts">
import { ref, computed } from "vue";
import type { AgentInfo, TranscriptTurn } from "../lib/protocol";
import { formatThreadStatus, truncate } from "../lib/format";

const activePanel = ref<
  "overview" | "files" | "tools" | "skills" | "channels" | "cron"
>("overview");

const props = defineProps<{
  loading: boolean;
  agents: AgentInfo[];
  selectedAgentId: string | null;
  transcript: TranscriptTurn[];
}>();

const selectedAgent = computed(
  () => props.agents.find((a) => a.name === props.selectedAgentId) || null,
);

const emit = defineEmits<{
  refresh: [];
  select: [agentId: string];
  openConversation: [agentId: string];
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
          :key="agent.name"
          class="agent-row"
          :class="{ active: agent.name === selectedAgentId }"
          @click="emit('select', agent.name)"
        >
          <div class="agent-avatar">
            {{ agent.name.slice(0, 1).toUpperCase() }}
          </div>
          <div class="agent-info">
            <div class="agent-title">{{ agent.name }}</div>
            <div class="agent-sub mono">
              {{ agent.workspace || "default workspace" }}
            </div>
          </div>
        </button>
      </div>
    </aside>

    <section class="agents-main">
      <template v-if="selectedAgent">
        <section class="card agent-header">
          <div class="agent-header-main">
            <div class="agent-avatar agent-avatar--lg">
              {{ selectedAgent.name.slice(0, 1).toUpperCase() }}
            </div>
            <div>
              <div class="card-title">{{ selectedAgent.name }}</div>
              <div class="card-sub">
                {{
                  truncate(
                    selectedAgent.description ||
                      "Agent configuration from config.toml",
                    140,
                  )
                }}
              </div>
            </div>
          </div>
          <div class="agent-header-meta">
            <div class="mono">{{ selectedAgent.name }}</div>
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
          <div class="card-sub">Configuration from config.toml.</div>

          <div class="agents-overview-grid mt-6">
            <div class="agent-kv">
              <div class="card-sub">Name</div>
              <div class="mono">{{ selectedAgent.name }}</div>
            </div>
            <div class="agent-kv">
              <div class="card-sub">Description</div>
              <div>{{ selectedAgent.description || "No description" }}</div>
            </div>
            <div class="agent-kv">
              <div class="card-sub">Workspace</div>
              <div class="mono">{{ selectedAgent.workspace || "default" }}</div>
            </div>
            <div class="agent-kv">
              <div class="card-sub">Config File</div>
              <div class="mono">{{ selectedAgent.configFile || "inline" }}</div>
            </div>
            <div class="agent-kv">
              <div class="card-sub">Nickname Candidates</div>
              <div>
                {{ selectedAgent.nicknameCandidates?.join(", ") || "none" }}
              </div>
            </div>
          </div>
        </section>

        <section v-else-if="activePanel === 'files'" class="card">
          <div class="card-title">Files</div>
          <div class="card-sub">
            File browsing for Codex subagents will land here next.
          </div>
        </section>

        <section v-else-if="activePanel === 'tools'" class="card">
          <div class="card-title">Tools</div>
          <div class="card-sub">
            Tool permissions and tool activity are next in line for parity.
          </div>
        </section>

        <section v-else-if="activePanel === 'skills'" class="card">
          <div class="card-title">Skills</div>
          <div class="card-sub">
            Installed skills and toggles will appear in this panel.
          </div>
        </section>

        <section v-else-if="activePanel === 'channels'" class="card">
          <div class="card-title">Channels</div>
          <div class="card-sub">
            Delivery channels are not wired for Codex yet.
          </div>
        </section>

        <section v-else class="card">
          <div class="card-title">Cron Jobs</div>
          <div class="card-sub">
            Scheduled automation parity is still to come.
          </div>
        </section>

        <section class="card">
          <div class="card-title">Transcript</div>
          <div class="card-sub">Recent activity from the selected thread.</div>

          <div
            v-if="transcript.length > 0"
            class="mt-4 flex max-h-[34rem] flex-col gap-5 overflow-auto"
          >
            <div
              v-for="turn in transcript"
              :key="turn.id"
              class="flex flex-col gap-2.5"
            >
              <div
                class="flex items-center justify-between gap-3 text-xs uppercase tracking-[0.1em] text-[var(--muted)]"
              >
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
                        borderColor:
                          'color-mix(in srgb, var(--border-strong) 28%, transparent)',
                        background:
                          'color-mix(in srgb, var(--bg-elevated) 86%, transparent)',
                        color: 'var(--chat-text)',
                      }
                    : item.kind === 'activity'
                      ? {
                          borderColor:
                            'color-mix(in srgb, var(--accent-2) 26%, transparent)',
                          background:
                            'color-mix(in srgb, var(--accent-2-subtle) 85%, var(--bg-elevated))',
                          color: 'var(--text)',
                        }
                      : {
                          borderColor:
                            'color-mix(in srgb, var(--accent) 46%, transparent)',
                          background:
                            'linear-gradient(180deg, color-mix(in srgb, var(--accent) 86%, #ffffff), color-mix(in srgb, var(--accent) 78%, #000000))',
                          color: 'var(--accent-foreground)',
                        }
                "
              >
                <div
                  v-if="item.kind === 'activity'"
                  class="mb-2 text-sm font-semibold text-[var(--accent-2)]"
                >
                  {{ item.label }}
                </div>
                <pre>{{
                  item.kind === "activity" ? item.detail : item.text
                }}</pre>
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
        <div class="card-sub">
          Pick an agent to inspect its workspace and tools.
        </div>
      </div>
    </section>
  </section>
</template>
