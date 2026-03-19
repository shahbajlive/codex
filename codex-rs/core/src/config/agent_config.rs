use serde::Deserialize;
use serde::Serialize;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AgentConfig {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,

    #[serde(default = "default_extends")]
    pub extends: Option<String>,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reasoning_effort: Option<String>,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub developer_instructions: Option<String>,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workspace: Option<String>,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tools: Option<AgentToolsConfig>,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub skills: Option<Vec<String>>,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub subagents: Option<SubAgentConfig>,
}

fn default_extends() -> Option<String> {
    Some("main".to_string())
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct AgentToolsConfig {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub allow: Option<Vec<String>>,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub deny: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct SubAgentConfig {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_depth: Option<i32>,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_threads: Option<usize>,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub allow_agents: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentInfo {
    pub id: String,
    pub name: Option<String>,
    pub description: Option<String>,
    pub extends: Option<String>,
    pub has_workspace: bool,
    pub workspace_path: Option<String>,
}

impl AgentInfo {
    pub fn new(id: String) -> Self {
        Self {
            id,
            name: None,
            description: None,
            extends: Some("main".to_string()),
            has_workspace: false,
            workspace_path: None,
        }
    }
}
