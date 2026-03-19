<script setup lang="ts">
import { ref, computed, watch } from "vue";
import type { SkillMetadata } from "../../lib/protocol";
import { useCodexStore } from "../../stores/codex";

const props = defineProps<{
  skills?: string[];
  workspace?: string;
  loading?: boolean;
  saving?: boolean;
}>();

const emit = defineEmits<{
  save: [skills: string[] | undefined];
  discard: [];
}>();

const codexStore = useCodexStore();

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
  skills: SkillMetadata[];
};

const skillCatalog = computed(() => codexStore.skillCatalog ?? []);

const filteredSkills = computed(() => {
  const q = filterText.value.trim().toLowerCase();
  if (!q) return skillCatalog.value;
  return skillCatalog.value.filter(
    (s) =>
      s.name.toLowerCase().includes(q) ||
      s.description.toLowerCase().includes(q),
  );
});

const skillGroups = computed<SkillGroup[]>(() => {
  const groups: SkillGroup[] = [];
  for (const group of SKILL_SCOPE_GROUPS) {
    const groupSkills = filteredSkills.value.filter((s) =>
      group.scopes.includes(s.scope),
    );
    if (groupSkills.length > 0) {
      groups.push({ id: group.id, label: group.label, skills: groupSkills });
    }
  }
  return groups;
});

const enabledCount = computed(() => {
  if (usingAllowlist.value) {
    return allowSet.value.size;
  }
  return skillCatalog.value.length;
});

const totalCount = computed(() => skillCatalog.value.length);

// allowSet: the skills that ARE enabled
// When not using allowlist, all skills are enabled
// When using allowlist, only skills in allowSet are enabled
const allowSet = ref<Set<string>>(new Set());
const usingAllowlist = ref(false);

watch(
  () => props.skills,
  (skills) => {
    allowSet.value = new Set(skills ?? []);
    usingAllowlist.value = skills !== undefined;
  },
  { immediate: true },
);

const dirty = computed(() => {
  if (usingAllowlist.value) return true;
  if (allowSet.value.size !== totalCount.value) return true;
  return false;
});

function isSkillEnabled(skillName: string): boolean {
  if (usingAllowlist.value) {
    return allowSet.value.has(skillName);
  }
  return true;
}

function toggleSkill(skillName: string, enabled: boolean) {
  if (!usingAllowlist.value && enabled) {
    return;
  }
  if (!usingAllowlist.value && !enabled) {
    usingAllowlist.value = true;
    allowSet.value = new Set(skillCatalog.value.map((s) => s.name));
    allowSet.value.delete(skillName);
  } else {
    if (enabled) {
      allowSet.value.add(skillName);
    } else {
      allowSet.value.delete(skillName);
    }
  }
}

function onUseAll() {
  allowSet.value = new Set();
  usingAllowlist.value = false;
  emit("save", undefined);
}

function onDisableAll() {
  allowSet.value = new Set();
  usingAllowlist.value = true;
  emit("save", []);
}

function onDiscard() {
  allowSet.value = new Set(props.skills ?? []);
  usingAllowlist.value = props.skills !== undefined;
  emit("discard");
}

function onSave() {
  const skills = usingAllowlist.value ? [...allowSet.value] : undefined;
  emit("save", skills);
}

async function onRefresh() {
  error.value = null;
  try {
    await codexStore.loadSkillCatalog(props.workspace);
  } catch (e) {
    error.value = String(e);
  }
}
</script>

<template>
  <div>
    <div class="row" style="justify-content: space-between">
      <div>
        <div class="card-title">Skills</div>
        <div class="card-sub">
          Per-agent skill allowlist.
          <span v-if="totalCount > 0" class="mono">
            {{ enabledCount }}/{{ totalCount }}
          </span>
        </div>
      </div>
      <div class="row" style="gap: 8px">
        <button type="button" class="btn btn--sm" @click="onUseAll">
          Use All
        </button>
        <button type="button" class="btn btn--sm" @click="onDisableAll">
          Disable All
        </button>
        <button type="button" class="btn btn--sm" @click="onRefresh">
          {{ loading ? "Loading…" : "Refresh" }}
        </button>
        <button
          type="button"
          class="btn btn--sm primary"
          :disabled="saving || !dirty"
          @click="onSave"
        >
          {{ saving ? "Saving…" : "Save" }}
        </button>
      </div>
    </div>

    <div v-if="usingAllowlist" class="callout info" style="margin-top: 12px">
      This agent uses a custom skill allowlist.
    </div>
    <div v-else class="callout info" style="margin-top: 12px">
      All skills are enabled. Disabling any skill will create a per-agent
      allowlist.
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
      v-if="skillGroups.length === 0 && !loading"
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
                    type="checkbox"
                    :checked="isSkillEnabled(skill.name)"
                    @change="
                      toggleSkill(
                        skill.name,
                        ($event.target as HTMLInputElement).checked,
                      )
                    "
                  />
                  <span class="cfg-toggle__track"></span>
                </label>
              </div>
            </div>
          </div>
        </details>
      </div>
    </div>

    <div
      v-if="dirty"
      class="row"
      style="justify-content: flex-end; gap: 8px; margin-top: 16px"
    >
      <button type="button" class="btn btn--sm" @click="onDiscard">
        Discard
      </button>
    </div>
  </div>
</template>
