Here's the implementation plan:
---
Implementation Plan: Isolated Agents for Codex
Overview
Create a new agent system with:
- JSON5 config files (folder name = agent id)
- Per-agent workspaces with bootstrap files (AGENTS.md, SOUL.md, etc.)
- Tool/Skill allowlists per agent
- Inheritance from "main" agent
- Backward compatibility with existing TOML agents
---
Phase 1: Backend - Core Infrastructure
Step 1.1: Create Agent Config Schema
Files: New file in core/src/config/
// core/src/config/agent_config.rs
pub struct AgentConfig {
pub id: String,                    // From folder name, NOT in file
pub name: Option<String>,
pub description: Option<String>,
pub extends: Option<String>,        // Inheritance: default "main"

    // Agent settings
    pub model: Option<String>,
    pub reasoning_effort: Option<String>,
    pub developer_instructions: Option<String>,
    pub workspace: Option<String>,      // Relative to agent dir
    
    // Tools (allow/deny lists)
    pub tools: Option<AgentToolsConfig>,
    
    // Skills allowlist
    pub skills: Option<Vec<String>>,
    
    // Subagent config
    pub subagents: Option<SubAgentConfig>,
}
pub struct AgentToolsConfig {
pub allow: Option<Vec<String>>,
pub deny: Option<Vec<String>>,
}
pub struct SubAgentConfig {
pub max_depth: Option<i32>,
pub max_threads: Option<usize>,
pub allow_agents: Option<Vec<String>>,
}
JSON5 format:
{
"name": "Research Agent",
"description": "Research-focused agent",
"extends": "main",
"model": "o4-mini",
"developerInstructions": "You are a research agent...",
"workspace": "./workspace",
"tools": {
"allow": ["shell", "search"],
"deny": ["artifact"]
},
"skills": ["coding", "research"],
"subagents": {
"maxDepth": 3,
"maxThreads": 5,
"allowAgents": ["worker"]
}
}
Step 1.2: Create AgentConfigService
Files: New file core/src/config/agent_service.rs
pub struct AgentConfigService {
codex_agents_dir: PathBuf,
}
impl AgentConfigService {
pub fn new(codex_agents_dir: PathBuf) -> Self;

    pub fn load_agent(&self, id: &str) -> Result<AgentConfig, AgentConfigError>;
    
    pub fn list_agents(&self) -> Result<Vec<AgentInfo>, AgentConfigError>;
    
    pub fn save_agent(&self, id: &str, config: &AgentConfig) -> Result<(), AgentConfigError>;
    
    pub fn delete_agent(&self, id: &str) -> Result<(), AgentConfigError>;
    
    // Load agent with inheritance resolution
    pub fn resolve_agent(&self, id: &str) -> Result<ResolvedAgentConfig, AgentConfigError>;
    
    // Get workspace path for agent
    pub fn workspace_path(&self, id: &str) -> PathBuf;
    
    // Ensure bootstrap files exist
    pub fn ensure_workspace(&self, id: &str) -> Result<(), AgentConfigError>;
}
Step 1.3: Environment Configuration
Files: core/src/config/mod.rs
Add support for CODEX_AGENTS_DIR env variable:
pub fn find_codex_agents_dir() -> PathBuf {
std::env::var("CODEX_AGENTS_DIR")
.map(PathBuf::from)
.unwrap_or_else(|_| {
find_codex_home()
.map(|h| h.join("agents"))
.unwrap_or_else(|_| PathBuf::from(".codex/agents"))
})
}
Step 1.4: Resolve Agent Inheritance
Files: agent_service.rs
impl AgentConfigService {
pub fn resolve_agent(&self, id: &str) -> Result<ResolvedAgentConfig> {
let mut configs = Vec::new();
let mut current_id = id.to_string();

        // Walk inheritance chain
        loop {
            match self.load_agent(&current_id) {
                Ok(config) => {
                    configs.push(config);
                    match &config.extends {
                        Some(parent) => current_id = parent.clone(),
                        None => break,
                    }
                }
                Err(_) => break,  // Parent doesn't exist, stop
            }
        }
        
        // Merge configs (child overrides parent)
        Ok(ResolvedAgentConfig::merge(configs))
    }
}
Step 1.5: Integrate with ConfigService
Files: core/src/config/service.rs
Add methods to use AgentConfigService:
impl ConfigService {
pub async fn load_agent_config(&self, agent_id: &str) -> Result<AgentConfig, ...>;

    pub async fn build_config_for_agent(&self, agent_id: &str) -> Result<Config, ...>;
}
---
Phase 2: Backend - Agent RPC Updates
Step 2.1: Update Protocol Definitions
Files: app-server-protocol/src/protocol/v2.rs
Update existing RPCs:
// agent/list
pub struct AgentListParams {
pub cwd: Option<String>,       // Keep for backward compat
pub agent_dir: Option<String>, // NEW: CODEX_AGENTS_DIR override
}
// agent/read  
pub struct AgentReadParams {
pub id: String,                // CHANGE: id (not name)
pub cwd: Option<String>,
pub agent_dir: Option<String>,
}
// agent/update
pub struct AgentUpdateParams {
pub id: String,                // CHANGE: id (not name)
// Keep existing fields
pub name: Option<String>,
pub model: Option<String>,
pub developer_instructions: Option<String>,
pub nickname_candidates: Option<Vec<String>>,
pub tools: Option<AgentToolsConfig>,   // NEW
pub skills: Option<Vec<String>>,       // NEW
pub extends: Option<String>,            // NEW
pub workspace: Option<String>,         // NEW
}
// NEW: agent/create
pub struct AgentCreateParams {
pub id: String,
pub name: Option<String>,
pub extends: Option<String>,  // default "main"
}
// NEW: agent/delete
pub struct AgentDeleteParams {
pub id: String,
}
Step 2.2: Update ConfigApi Handlers
Files: app-server/src/config_api.rs
Add new handlers:
impl ConfigApi {
pub async fn agent_create(&self, params: AgentCreateParams) -> Result<AgentInfo, ...>;
pub async fn agent_delete(&self, params: AgentDeleteParams) -> Result<(), ...>;
}
Step 2.3: Update MessageProcessor
Files: app-server/src/message_processor.rs
Add handlers for new RPCs.
---
Phase 3: Backend - Tools & Skills Integration
Step 3.1: Tool Filtering
Files: core/src/tools/spec.rs or new file
When building tools for an agent:
pub fn filter_tools_for_agent(tools: Vec<ToolSpec>, agent_config: &AgentConfig) -> Vec<ToolSpec> {
let allowed = agent_config.tools.as_ref();

    tools.into_iter().filter(|tool| {
        let tool_name = &tool.name;
        
        // Check deny list first
        if let Some(deny) = allowed.and_then(|a| a.deny.as_ref()) {
            if deny.contains(tool_name) {
                return false;
            }
        }
        
        // Check allow list
        if let Some(allow) = allowed.and_then(|a| a.allow.as_ref()) {
            allow.contains(tool_name)
        } else {
            true  // No allow list = all allowed
        }
    }).collect()
}
Step 3.2: Skill Filtering
Files: core/src/skills/manager.rs
When loading skills for an agent:
pub fn skills_for_agent(&self, agent_config: &AgentConfig) -> Vec<SkillMetadata> {
let allowed_skills = agent_config.skills.as_ref();

    self.all_skills.iter()
        .filter(|skill| {
            match allowed_skills {
                Some(allowlist) => allowlist.contains(&skill.name),
                None => true,  // No allowlist = all allowed
            }
        })
        .cloned()
        .collect()
}
---
Phase 4: Backend - Workspace Bootstrap Files
Step 4.1: Bootstrap File Templates
Files: New file core/src/config/bootstrap_templates.rs
pub static BOOTSTRAP_FILES: &[(&str, &str)] = &[
("AGENTS.md", r#"# Workspace Instructions
..."#),
("SOUL.md", r#"# Agent Identity
..."#),
("TOOLS.md", r#"# Local Tool Notes
..."#),
("IDENTITY.md", r#"# Agent Metadata
Name:
Type:
..."#),
("USER.md", r#"# User Profile
Name:
..."#),
("HEARTBEAT.md", r#"# Periodic Tasks
..."#),
("BOOTSTRAP.md", r#"# First Run
..."#),
("MEMORY.md", r#"# Long-term Memory
..."#),
];
Step 4.2: Ensure Workspace
Files: agent_service.rs
pub fn ensure_workspace(&self, agent_id: &str) -> Result<PathBuf> {
let workspace = self.workspace_path(agent_id);
std::fs::create_dir_all(&workspace)?;

    // Create bootstrap files if they don't exist
    for (filename, template) in BOOTSTRAP_FILES {
        let path = workspace.join(filename);
        if !path.exists() {
            std::fs::write(&path, *template)?;
        }
    }
    
    Ok(workspace)
}
---
Phase 5: Frontend Updates
Step 5.1: Update Protocol Types
Regenerate from updated Rust types:
just write-app-server-schema
Step 5.2: Update API Client
Files: ui/src/lib/app-server-client.ts
Add new methods:
async createAgent(id: string, options?: CreateAgentOptions): Promise<AgentInfo>
async deleteAgent(id: string): Promise<void>
async resolveAgent(id: string): Promise<ResolvedAgentConfig>
Step 5.3: Update Store
Files: ui/src/stores/codex.ts
Add actions:
async createAgent(id: string, options?: CreateAgentOptions)
async deleteAgent(id: string)
async selectAgent(id: string)  // Uses resolveAgent
Step 5.4: Update AgentsPane UI
Files: ui/src/components/AgentsPane.vue
- Add agent creation UI (new agent button, form)
- Add agent deletion UI
- Update Tools tab to show actual tools from agent
- Update Skills tab to show actual skills for agent
- Add workspace path display
---
Phase 6: Backward Compatibility
Step 6.1: Support TOML Agents
Files: agent_service.rs
impl AgentConfigService {
fn load_agent(&self, id: &str) -> Result<AgentConfig> {
// Try JSON5 first
let json5_path = self.agent_dir(id).join("agent.json5");
if json5_path.exists() {
return self.load_json5_agent(&json5_path);
}

        // Fall back to TOML
        let toml_path = self.codex_agents_dir.join(format!("{}.toml", id));
        if toml_path.exists() {
            return self.load_toml_agent(&toml_path, id);
        }
        
        Err(AgentConfigError::NotFound)
    }
}
Step 6.2: Migrate Tool
Files: CLI tool or migration script
Convert existing TOML agents to JSON5 format.
---
Summary of File Changes
New Files
File
core/src/config/agent_config.rs
core/src/config/agent_service.rs
core/src/config/bootstrap_templates.rs
Modified Files
File
core/src/config/mod.rs
core/src/config/service.rs
core/src/tools/spec.rs
core/src/skills/manager.rs
app-server-protocol/src/protocol/v2.rs
app-server/src/config_api.rs
app-server/src/message_processor.rs
ui/src/lib/app-server-client.ts
ui/src/stores/codex.ts
ui/src/components/AgentsPane.vue
---
## Dependencies
1. **json5** crate for Rust - Add to `core/Cargo.toml`
2. Regenerate TypeScript schemas
3. Update tests
---
Questions Before Proceeding
1. Bootstrap file content: Should we use the exact templates from OpenClaw or customize for Codex?
2. Migration: Should we auto-migrate existing TOML agents on first load, or keep them as-is?
3. "main" agent: Should we auto-create a default "main" agent on first run, or require explicit creation?