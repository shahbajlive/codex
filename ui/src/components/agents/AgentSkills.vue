<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { useAgentsStore } from "../../stores/agents";

const agentsStore = useAgentsStore();

const filterText = ref("");
const error = ref<string | null>(null);

const SKILL_SCOPE_GROUPS = [
  { id: "workspace", label: "Workspace Skills", scopes: ["user", "repo"] },
  { id: "built-in", label: "Built-in Skills", scopes: ["system"] },
  { id: "installed", label: "Installed Skills", scopes: ["admin"] },
] as const;

type SkillGroup = {
  id: string;
  label: string;
  skills: Array<{ name: string; description: string; scope: string }>;
};

const filteredSkills = computed(() => {
  const q = filterText.value.trim().toLowerCase();
  if (!q) return agentsStore.skillCatalog;
  return agentsStore.skillCatalog.filter(
    (s) =>
      s.name.toLowerCase().includes(q) ||
      s.description.toLowerCase().includes(q),
  );
});

const skillGroups = computed<SkillGroup[]>(() => {
  const groups: SkillGroup[] = [];
  for (const group of SKILL_SCOPE_GROUPS) {
    const groupSkills = filteredSkills.value
      .filter((s) => group.scopes.includes(s.scope))
      .map((s) => ({
        name: s.name,
        description: s.description,
        scope: s.scope,
      }));
    if (groupSkills.length > 0) {
      groups.push({ id: group.id, label: group.label, skills: groupSkills });
    }
  }
  return groups;
});

const usingAllowlist = computed(
  () => (agentsStore.config?.skills.length ?? 0) > 0,
);

const enabledCount = computed(() => {
  if (usingAllowlist.value) {
    return agentsStore.config?.skills.length ?? 0;
  }
  return agentsStore.skillCatalog.length;
});

const totalCount = computed(() => agentsStore.skillCatalog.length);

async function onRefresh() {
  error.value = null;
  try {
    await agentsStore.loadSkillCatalog();
  } catch (e) {
    error.value = String(e);
  }
}

onMounted(() => {
  if (agentsStore.skillCatalog.length === 0) {
    onRefresh();
  }
});
</script>

<template>
  <form class="card">
    <div class="card-header">
      <div>
        <div class="card-title">Skills</div>
        <div class="card-sub">
          Per-agent skill allowlist.
          <span v-if="totalCount > 0" class="mono"
            >{{ enabledCount }}/{{ totalCount }}</span
          >
        </div>
      </div>
      <div class="row">
        <button type="button" class="btn btn--sm" @click="onRefresh">
          {{ agentsStore.skillsLoading ? "Loading…" : "Refresh" }}
        </button>
      </div>
    </div>

    <div v-if="usingAllowlist" class="callout info" style="margin-top: 12px">
      This agent uses a custom skill allowlist.
    </div>
    <div v-else class="callout info" style="margin-top: 12px">
      All skills are enabled.
    </div>

    <div v-if="error" class="callout danger" style="margin-top: 12px">
      {{ error }}
    </div>

    <div class="filters" style="margin-top: 14px">
      <label class="field" style="flex: 1">
        <span>Filter</span>
        <input v-model="filterText" type="text" placeholder="Search skills" />
      </label>
      <div class="muted">{{ filteredSkills.length }} shown</div>
    </div>

    <div
      v-if="skillGroups.length === 0 && !agentsStore.skillsLoading"
      class="muted"
      style="margin-top: 16px"
    >
      No skills found.
    </div>

    <div v-else class="agent-skills-groups" style="margin-top: 16px">
      <div
        v-for="group in skillGroups"
        :key="group.id"
        class="agent-skills-group"
      >
        <details open>
          <summary class="agent-skills-header">
            <span>{{ group.label }}</span>
            <span class="muted">{{ group.skills.length }}</span>
          </summary>
          <div class="skills-grid">
            <div
              v-for="skill in group.skills"
              :key="skill.name"
              class="agent-skill-row"
            >
              <div class="list-main">
                <div class="list-title">{{ skill.name }}</div>
                <div class="list-sub">{{ skill.description }}</div>
                <div class="chip-row" style="margin-top: 6px">
                  <span class="chip">{{ skill.scope }}</span>
                </div>
              </div>
              <div class="list-meta">
                <label class="cfg-toggle">
                  <input
                    :checked="agentsStore.isSkillEnabled(skill.name)"
                    @change="agentsStore.toggleSkill(skill.name)"
                    type="checkbox"
                  />
                  <span class="cfg-toggle__track"></span>
                </label>
              </div>
            </div>
          </div>
        </details>
      </div>
    </div>
  </form>
</template>
