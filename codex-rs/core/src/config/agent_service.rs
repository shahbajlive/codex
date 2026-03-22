use std::path::PathBuf;

use thiserror::Error;

use crate::config::agent_config::AgentConfig;
use crate::config::agent_config::AgentInfo;

#[derive(Error, Debug)]
pub enum AgentConfigError {
    #[error("Agent not found: {0}")]
    NotFound(String),

    #[error("Invalid agent ID: {0}")]
    InvalidId(String),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("JSON5 parse error: {0}")]
    Parse(#[from] json5::Error),

    #[error("TOML parse error: {0}")]
    TomlParse(#[from] toml::de::Error),

    #[error("Serialization error: {0}")]
    Serialize(#[from] serde_json::Error),
}

pub struct AgentConfigService {
    codex_agents_dir: PathBuf,
}

impl AgentConfigService {
    pub fn new(codex_agents_dir: PathBuf) -> Self {
        Self { codex_agents_dir }
    }

    pub fn codex_agents_dir(&self) -> &PathBuf {
        &self.codex_agents_dir
    }

    pub fn agent_dir(&self, id: &str) -> PathBuf {
        self.codex_agents_dir.join(id)
    }

    pub fn load_agent(&self, id: &str) -> Result<AgentConfig, AgentConfigError> {
        if !is_valid_agent_id(id) {
            return Err(AgentConfigError::InvalidId(id.to_string()));
        }

        let agent_dir = self.agent_dir(id);
        let config_path = agent_dir.join("agent.json5");

        if config_path.exists() {
            self.load_json5_agent(&config_path)
        } else {
            let toml_path = self.codex_agents_dir.join(format!("{}.toml", id));
            if toml_path.exists() {
                self.load_toml_agent(&toml_path, id)
            } else {
                Err(AgentConfigError::NotFound(id.to_string()))
            }
        }
    }

    fn load_json5_agent(&self, path: &PathBuf) -> Result<AgentConfig, AgentConfigError> {
        let content = std::fs::read_to_string(path)?;
        let config: AgentConfig = json5::from_str(&content)?;
        Ok(config)
    }

    fn load_toml_agent(&self, path: &PathBuf, _id: &str) -> Result<AgentConfig, AgentConfigError> {
        let content = std::fs::read_to_string(path)?;
        let toml_config: toml::Value = toml::from_str(&content)?;

        let name = toml_config
            .get("name")
            .and_then(|v| v.as_str())
            .map(String::from);

        let description = toml_config
            .get("description")
            .and_then(|v| v.as_str())
            .map(String::from);

        let model = toml_config
            .get("model")
            .and_then(|v| v.as_str())
            .map(String::from);

        let developer_instructions = toml_config
            .get("developer_instructions")
            .and_then(|v| v.as_str())
            .map(String::from);

        Ok(AgentConfig {
            name,
            description,
            extends: None,
            model,
            approval_policy: None,
            sandbox_mode: None,
            reasoning_effort: None,
            developer_instructions,
            workspace: None,
            tools: None,
            skills: None,
            subagents: None,
            contacts: None,
        })
    }

    pub fn list_agents(&self) -> Result<Vec<AgentInfo>, AgentConfigError> {
        let mut agents = Vec::new();

        if !self.codex_agents_dir.exists() {
            return Ok(agents);
        }

        for entry in std::fs::read_dir(&self.codex_agents_dir)? {
            let entry = entry?;
            let path = entry.path();

            if path.is_dir() {
                if let Some(id) = path.file_name().and_then(|n| n.to_str()) {
                    if is_valid_agent_id(id) {
                        let config_path = path.join("agent.json5");
                        let has_config = config_path.exists();
                        let has_workspace = path.join("workspace").exists();

                        if has_config {
                            match self.load_agent(id) {
                                Ok(config) => {
                                    agents.push(AgentInfo {
                                        id: id.to_string(),
                                        name: config.name,
                                        description: config.description,
                                        extends: config.extends,
                                        has_workspace,
                                        workspace_path: Some(
                                            path.join("workspace").to_string_lossy().to_string(),
                                        ),
                                    });
                                }
                                Err(_) => {
                                    agents.push(AgentInfo::new(id.to_string()));
                                }
                            }
                        }
                    }
                }
            } else if path.extension().and_then(|e| e.to_str()) == Some("toml") {
                if let Some(id) = path.file_stem().and_then(|n| n.to_str()) {
                    if is_valid_agent_id(id) {
                        let has_workspace = path
                            .parent()
                            .map(|p| p.join(format!("{}/workspace", id)))
                            .map(|p| p.exists())
                            .unwrap_or(false);

                        match self.load_agent(id) {
                            Ok(config) => {
                                agents.push(AgentInfo {
                                    id: id.to_string(),
                                    name: config.name,
                                    description: config.description,
                                    extends: config.extends,
                                    has_workspace,
                                    workspace_path: if has_workspace {
                                        Some(
                                            path.parent()
                                                .map(|p| p.join(format!("{}/workspace", id)))
                                                .unwrap()
                                                .to_string_lossy()
                                                .to_string(),
                                        )
                                    } else {
                                        None
                                    },
                                });
                            }
                            Err(_) => {
                                agents.push(AgentInfo::new(id.to_string()));
                            }
                        }
                    }
                }
            }
        }

        Ok(agents)
    }

    pub fn save_agent(&self, id: &str, config: &AgentConfig) -> Result<(), AgentConfigError> {
        if !is_valid_agent_id(id) {
            return Err(AgentConfigError::InvalidId(id.to_string()));
        }

        let agent_dir = self.agent_dir(id);
        std::fs::create_dir_all(&agent_dir)?;

        let config_path = agent_dir.join("agent.json5");
        let content = json5::to_string(config)?;
        std::fs::write(config_path, content)?;

        Ok(())
    }

    pub fn delete_agent(&self, id: &str) -> Result<(), AgentConfigError> {
        if !is_valid_agent_id(id) {
            return Err(AgentConfigError::InvalidId(id.to_string()));
        }

        let agent_dir = self.agent_dir(id);
        if !agent_dir.exists() {
            return Err(AgentConfigError::NotFound(id.to_string()));
        }

        std::fs::remove_dir_all(agent_dir)?;
        Ok(())
    }

    pub fn workspace_path(&self, id: &str) -> PathBuf {
        self.agent_dir(id).join("workspace")
    }

    pub fn resolve_agent(&self, id: &str) -> Result<ResolvedAgentConfig, AgentConfigError> {
        let mut configs = Vec::new();
        let mut current_id = id.to_string();

        loop {
            match self.load_agent(&current_id) {
                Ok(config) => {
                    configs.push(config.clone());
                    match &config.extends {
                        Some(parent) if parent != &current_id => {
                            current_id = parent.clone();
                        }
                        _ => break,
                    }
                }
                Err(AgentConfigError::NotFound(_)) => break,
                Err(e) => return Err(e),
            }
        }

        let workspace_instructions = self.get_workspace_instructions(id).unwrap_or_default();
        Ok(ResolvedAgentConfig::merge(configs, workspace_instructions))
    }

    pub fn ensure_workspace(&self, id: &str) -> Result<PathBuf, AgentConfigError> {
        if !is_valid_agent_id(id) {
            return Err(AgentConfigError::InvalidId(id.to_string()));
        }

        let workspace = self.workspace_path(id);
        std::fs::create_dir_all(&workspace)?;

        for (filename, template) in BOOTSTRAP_FILES {
            let path = workspace.join(filename);
            if !path.exists() {
                std::fs::write(&path, *template)?;
            }
        }

        Ok(workspace)
    }

    pub fn get_workspace_instructions(&self, id: &str) -> Result<String, AgentConfigError> {
        let workspace = self.workspace_path(id);
        if !workspace.exists() {
            return Ok(String::new());
        }

        let mut combined = String::new();
        for (filename, _) in BOOTSTRAP_FILES {
            let path = workspace.join(filename);
            if path.exists() {
                if let Ok(content) = std::fs::read_to_string(&path) {
                    if !content.trim().is_empty() {
                        combined.push_str(&format!("\n\n---\n\nFile: {}\n\n", filename));
                        combined.push_str(&content);
                    }
                }
            }
        }

        Ok(combined)
    }

    pub fn list_workspace_files(&self, id: &str) -> Vec<(String, String)> {
        let workspace = self.workspace_path(id);
        if !workspace.exists() {
            return Vec::new();
        }

        let mut files = Vec::new();
        for (filename, _) in BOOTSTRAP_FILES {
            let path = workspace.join(filename);
            if path.exists() {
                if let Ok(content) = std::fs::read_to_string(&path) {
                    files.push((filename.to_string(), content));
                }
            }
        }
        files
    }

    pub fn save_workspace_files(
        &self,
        id: &str,
        files: Vec<(String, String)>,
    ) -> Result<(), AgentConfigError> {
        let workspace = self.workspace_path(id);
        std::fs::create_dir_all(&workspace)?;
        for (filename, content) in files {
            let path = workspace.join(&filename);
            std::fs::write(&path, &content)?;
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct ResolvedAgentConfig {
    pub id: String,
    pub name: Option<String>,
    pub description: Option<String>,
    pub extends: Option<String>,
    pub model: Option<String>,
    pub approval_policy: Option<crate::protocol::AskForApproval>,
    pub sandbox_mode: Option<codex_protocol::config_types::SandboxMode>,
    pub reasoning_effort: Option<String>,
    pub developer_instructions: Option<String>,
    pub workspace: Option<String>,
    pub workspace_instructions: Option<String>,
    pub tools: Option<crate::config::agent_config::AgentToolsConfig>,
    pub skills: Option<Vec<String>>,
    pub subagents: Option<crate::config::agent_config::SubAgentConfig>,
    pub contacts: Option<crate::config::agent_config::AgentContactsConfig>,
}

impl ResolvedAgentConfig {
    fn merge(configs: Vec<AgentConfig>, workspace_instructions: String) -> Self {
        let mut resolved = ResolvedAgentConfig {
            id: String::new(),
            name: None,
            description: None,
            extends: None,
            model: None,
            approval_policy: None,
            sandbox_mode: None,
            reasoning_effort: None,
            developer_instructions: None,
            workspace: None,
            workspace_instructions: None,
            tools: None,
            skills: None,
            subagents: None,
            contacts: None,
        };

        for config in configs.iter().rev() {
            if resolved.id.is_empty() && !configs.is_empty() {
                resolved.id = configs
                    .last()
                    .map(|c| c.name.clone())
                    .flatten()
                    .unwrap_or_default();
            }
            if resolved.name.is_none() {
                resolved.name = config.name.clone();
            }
            if resolved.description.is_none() {
                resolved.description = config.description.clone();
            }
            if resolved.extends.is_none() {
                resolved.extends = config.extends.clone();
            }
            if resolved.model.is_none() {
                resolved.model = config.model.clone();
            }
            if resolved.approval_policy.is_none() {
                resolved.approval_policy = config.approval_policy.clone();
            }
            if resolved.sandbox_mode.is_none() {
                resolved.sandbox_mode = config.sandbox_mode.clone();
            }
            if resolved.reasoning_effort.is_none() {
                resolved.reasoning_effort = config.reasoning_effort.clone();
            }
            if resolved.developer_instructions.is_none() {
                resolved.developer_instructions = config.developer_instructions.clone();
            }
            if resolved.workspace.is_none() {
                resolved.workspace = config.workspace.clone();
            }
            if resolved.workspace_instructions.is_none() && !workspace_instructions.is_empty() {
                resolved.workspace_instructions = Some(workspace_instructions.clone());
            }
            if resolved.tools.is_none() {
                resolved.tools = config.tools.clone();
            }
            if resolved.skills.is_none() {
                resolved.skills = config.skills.clone();
            }
            if resolved.subagents.is_none() {
                resolved.subagents = config.subagents.clone();
            }
            if resolved.contacts.is_none() {
                resolved.contacts = config.contacts.clone();
            }
        }

        resolved
    }
}

fn is_valid_agent_id(id: &str) -> bool {
    !id.is_empty()
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

static BOOTSTRAP_FILES: &[(&str, &str)] = &[
    (
        "AGENTS.md",
        r#"# Workspace Instructions

This file contains agent-specific instructions that will be loaded when this agent is active.

## Guidelines
- Write instructions that customize this agent's behavior
- These instructions are prepended to the agent's context
"#,
    ),
    (
        "SOUL.md",
        r#"# Agent Identity

This file defines the core identity and purpose of this agent.

## Name
[Agent name]

## Purpose
[What this agent is designed to do]

## Personality
[How this agent should behave]
"#,
    ),
    (
        "TOOLS.md",
        r#"# Local Tool Notes

This file contains notes about available local tools and their usage.
"#,
    ),
    (
        "IDENTITY.md",
        r#"# Agent Metadata

- **Type**: isolated-agent
- **Version**: 1.0.0
"#,
    ),
    (
        "USER.md",
        r#"# User Profile

- **Name**: 
- **Preferences**:
"#,
    ),
    (
        "HEARTBEAT.md",
        r#"# Periodic Tasks

This file contains tasks that should be run periodically.
"#,
    ),
    (
        "BOOTSTRAP.md",
        r#"# First Run

Tasks to run on first initialization of this agent workspace.
"#,
    ),
    (
        "MEMORY.md",
        r#"# Long-term Memory

This file contains persistent memory for the agent.
"#,
    ),
];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_valid_agent_ids() {
        assert!(is_valid_agent_id("main"));
        assert!(is_valid_agent_id("my-agent"));
        assert!(is_valid_agent_id("my_agent"));
        assert!(is_valid_agent_id("agent123"));
        assert!(is_valid_agent_id("a"));
    }

    #[test]
    fn test_invalid_agent_ids() {
        assert!(!is_valid_agent_id(""));
        assert!(!is_valid_agent_id("my agent"));
        assert!(!is_valid_agent_id("my.agent"));
        assert!(!is_valid_agent_id("my/agent"));
    }
}
