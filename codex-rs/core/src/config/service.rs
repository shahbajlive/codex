use super::Config;
use super::ConfigToml;
use super::deserialize_config_toml_with_base;
use crate::config::edit::ConfigEdit;
use crate::config::edit::ConfigEditsBuilder;
use crate::config::managed_features::validate_explicit_feature_settings_in_config_toml;
use crate::config::managed_features::validate_feature_requirements_in_config_toml;
use crate::config_loader::CloudRequirementsLoader;
use crate::config_loader::ConfigLayerEntry;
use crate::config_loader::ConfigLayerStack;
use crate::config_loader::ConfigLayerStackOrdering;
use crate::config_loader::ConfigRequirementsToml;
use crate::config_loader::LoaderOverrides;
use crate::config_loader::load_config_layers_state;
use crate::config_loader::merge_toml_values;
use crate::path_utils;
use crate::path_utils::SymlinkWritePaths;
use crate::path_utils::resolve_symlink_write_paths;
use crate::path_utils::write_atomically;
use codex_app_server_protocol::AgentContactsConfig as ApiAgentContactsConfig;
use codex_app_server_protocol::AgentCreateResponse;
use codex_app_server_protocol::AgentDeleteResponse;
use codex_app_server_protocol::AgentInfo;
use codex_app_server_protocol::AgentListResponse;
use codex_app_server_protocol::AgentReadResponse;
use codex_app_server_protocol::AgentToolsConfig as ApiAgentToolsConfig;
use codex_app_server_protocol::AgentUpdateResponse;
use codex_app_server_protocol::AgentWorkspaceFile;
use codex_app_server_protocol::AgentWorkspaceFilesResponse;
use codex_app_server_protocol::AgentWorkspaceFilesUpdateResponse;
use codex_app_server_protocol::Config as ApiConfig;
use codex_app_server_protocol::ConfigBatchWriteParams;
use codex_app_server_protocol::ConfigLayerMetadata;
use codex_app_server_protocol::ConfigLayerSource;
use codex_app_server_protocol::ConfigReadParams;
use codex_app_server_protocol::ConfigReadResponse;
use codex_app_server_protocol::ConfigValueWriteParams;
use codex_app_server_protocol::ConfigWriteErrorCode;
use codex_app_server_protocol::ConfigWriteResponse;
use codex_app_server_protocol::MergeStrategy;
use codex_app_server_protocol::OverriddenMetadata;
use codex_app_server_protocol::WriteStatus;
use codex_config::CONFIG_TOML_FILE;
use codex_utils_absolute_path::AbsolutePathBuf;
use serde_json::Value as JsonValue;
use std::borrow::Cow;
use std::path::Path;
use std::path::PathBuf;
use thiserror::Error;
use tokio::task;
use toml::Value as TomlValue;
use toml_edit::Item as TomlItem;

#[derive(Debug, Error)]
pub enum ConfigServiceError {
    #[error("{message}")]
    Write {
        code: ConfigWriteErrorCode,
        message: String,
    },

    #[error("{context}: {source}")]
    Io {
        context: &'static str,
        #[source]
        source: std::io::Error,
    },

    #[error("{context}: {source}")]
    Json {
        context: &'static str,
        #[source]
        source: serde_json::Error,
    },

    #[error("{context}: {source}")]
    Toml {
        context: &'static str,
        #[source]
        source: toml::de::Error,
    },

    #[error("{context}: {source}")]
    Anyhow {
        context: &'static str,
        #[source]
        source: anyhow::Error,
    },
}

impl ConfigServiceError {
    fn write(code: ConfigWriteErrorCode, message: impl Into<String>) -> Self {
        Self::Write {
            code,
            message: message.into(),
        }
    }

    fn io(context: &'static str, source: std::io::Error) -> Self {
        Self::Io { context, source }
    }

    fn json(context: &'static str, source: serde_json::Error) -> Self {
        Self::Json { context, source }
    }

    fn toml(context: &'static str, source: toml::de::Error) -> Self {
        Self::Toml { context, source }
    }

    fn anyhow(context: &'static str, source: anyhow::Error) -> Self {
        Self::Anyhow { context, source }
    }

    pub fn write_error_code(&self) -> Option<ConfigWriteErrorCode> {
        match self {
            Self::Write { code, .. } => Some(code.clone()),
            _ => None,
        }
    }
}

#[derive(Clone)]
pub struct ConfigService {
    codex_home: PathBuf,
    cli_overrides: Vec<(String, TomlValue)>,
    loader_overrides: LoaderOverrides,
    cloud_requirements: CloudRequirementsLoader,
}

impl ConfigService {
    pub fn new(
        codex_home: PathBuf,
        cli_overrides: Vec<(String, TomlValue)>,
        loader_overrides: LoaderOverrides,
        cloud_requirements: CloudRequirementsLoader,
    ) -> Self {
        Self {
            codex_home,
            cli_overrides,
            loader_overrides,
            cloud_requirements,
        }
    }

    pub fn new_with_defaults(codex_home: PathBuf) -> Self {
        Self {
            codex_home,
            cli_overrides: Vec::new(),
            loader_overrides: LoaderOverrides::default(),
            cloud_requirements: CloudRequirementsLoader::default(),
        }
    }

    pub async fn build_config(&self, cwd: Option<&str>) -> std::io::Result<Config> {
        let cwd = cwd.map(PathBuf::from);
        crate::config::ConfigBuilder::default()
            .codex_home(self.codex_home.clone())
            .cli_overrides(self.cli_overrides.clone())
            .loader_overrides(self.loader_overrides.clone())
            .fallback_cwd(cwd)
            .cloud_requirements(self.cloud_requirements.clone())
            .build()
            .await
    }

    pub async fn read(
        &self,
        params: ConfigReadParams,
    ) -> Result<ConfigReadResponse, ConfigServiceError> {
        let layers = match params.cwd.as_deref() {
            Some(cwd) => {
                let cwd = AbsolutePathBuf::try_from(PathBuf::from(cwd)).map_err(|err| {
                    ConfigServiceError::io("failed to resolve config cwd to an absolute path", err)
                })?;
                crate::config::ConfigBuilder::default()
                    .codex_home(self.codex_home.clone())
                    .cli_overrides(self.cli_overrides.clone())
                    .loader_overrides(self.loader_overrides.clone())
                    .fallback_cwd(Some(cwd.to_path_buf()))
                    .cloud_requirements(self.cloud_requirements.clone())
                    .build()
                    .await
                    .map_err(|err| {
                        ConfigServiceError::io("failed to read configuration layers", err)
                    })?
                    .config_layer_stack
            }
            None => self.load_thread_agnostic_config().await.map_err(|err| {
                ConfigServiceError::io("failed to read configuration layers", err)
            })?,
        };

        let effective = layers.effective_config();

        let effective_config_toml: ConfigToml = effective
            .try_into()
            .map_err(|err| ConfigServiceError::toml("invalid configuration", err))?;

        let json_value = serde_json::to_value(&effective_config_toml)
            .map_err(|err| ConfigServiceError::json("failed to serialize configuration", err))?;
        let config: ApiConfig = serde_json::from_value(json_value)
            .map_err(|err| ConfigServiceError::json("failed to deserialize configuration", err))?;

        Ok(ConfigReadResponse {
            config,
            origins: layers.origins(),
            layers: params.include_layers.then(|| {
                layers
                    .get_layers(
                        ConfigLayerStackOrdering::HighestPrecedenceFirst,
                        /*include_disabled*/ true,
                    )
                    .iter()
                    .map(|layer| layer.as_layer())
                    .collect()
            }),
        })
    }

    pub async fn read_requirements(
        &self,
    ) -> Result<Option<ConfigRequirementsToml>, ConfigServiceError> {
        let layers = self
            .load_thread_agnostic_config()
            .await
            .map_err(|err| ConfigServiceError::io("failed to read configuration layers", err))?;

        let requirements = layers.requirements_toml().clone();
        if requirements.is_empty() {
            Ok(None)
        } else {
            Ok(Some(requirements))
        }
    }

    pub async fn agent_list(
        &self,
        cwd: Option<&str>,
    ) -> Result<AgentListResponse, ConfigServiceError> {
        let config = self.build_config(cwd).await.map_err(|err| {
            ConfigServiceError::io("failed to read configuration for agent list", err)
        })?;

        let mut agents = Vec::new();

        for (name, role) in &config.agent_roles {
            let config_file = role
                .config_file
                .as_ref()
                .map(|p| p.to_string_lossy().to_string());
            let workspace = role
                .config_file
                .as_ref()
                .and_then(|p| p.parent().map(|p| p.to_string_lossy().to_string()));
            let has_workspace = workspace.is_some();

            agents.push(AgentInfo {
                id: name.clone(),
                name: Some(name.clone()),
                description: role.description.clone(),
                config_file,
                nickname_candidates: role.nickname_candidates.clone(),
                workspace,
                extends: None,
                has_workspace,
            });
        }

        Ok(AgentListResponse { agents })
    }

    pub async fn agent_read(
        &self,
        name: &str,
        cwd: Option<&str>,
    ) -> Result<AgentReadResponse, ConfigServiceError> {
        let config = self.build_config(cwd).await.map_err(|err| {
            ConfigServiceError::io("failed to read configuration for agent read", err)
        })?;

        let role = config.agent_roles.get(name).ok_or_else(|| {
            ConfigServiceError::io(
                "agent not found",
                std::io::Error::new(
                    std::io::ErrorKind::NotFound,
                    format!("agent {} not found", name),
                ),
            )
        })?;

        let config_file = role
            .config_file
            .as_ref()
            .map(|p| p.to_string_lossy().to_string());
        let workspace = role
            .config_file
            .as_ref()
            .and_then(|p| p.parent().map(|p| p.to_string_lossy().to_string()));

        let role_config_json = if let Some(config_file_path) = &role.config_file {
            let content = std::fs::read_to_string(config_file_path)
                .map_err(|e| ConfigServiceError::io("failed to read agent config file", e))?;
            let toml_value: toml::Value = toml::from_str(&content)
                .map_err(|e| ConfigServiceError::toml("failed to parse agent config file", e))?;
            serde_json::to_value(toml_value).unwrap_or(JsonValue::Object(serde_json::Map::new()))
        } else {
            JsonValue::Object(serde_json::Map::new())
        };

        let model = role_config_json
            .get("model")
            .and_then(|v| v.as_str())
            .map(String::from);
        let developer_instructions = role_config_json
            .get("developer_instructions")
            .and_then(|v| v.as_str())
            .map(String::from);

        Ok(AgentReadResponse {
            id: name.to_string(),
            name: Some(name.to_string()),
            description: role.description.clone(),
            config_file,
            nickname_candidates: role.nickname_candidates.clone(),
            workspace: workspace.clone(),
            config: role_config_json,
            model,
            developer_instructions,
            extends: None,
            has_workspace: workspace.is_some(),
            workspace_instructions: None,
            tools: None,
            skills: None,
            contacts: None,
        })
    }

    pub async fn agent_update(
        &self,
        name: &str,
        cwd: Option<&str>,
        model: Option<&str>,
        developer_instructions: Option<&str>,
        nickname_candidates: Option<&[String]>,
    ) -> Result<AgentUpdateResponse, ConfigServiceError> {
        tracing::info!("agent_update called for: {} with cwd: {:?}", name, cwd);
        let config = self.build_config(cwd).await.map_err(|err| {
            ConfigServiceError::io("failed to read configuration for agent update", err)
        })?;

        let role = config.agent_roles.get(name).ok_or_else(|| {
            ConfigServiceError::io(
                "agent not found",
                std::io::Error::new(
                    std::io::ErrorKind::NotFound,
                    format!("agent {} not found", name),
                ),
            )
        })?;
        tracing::info!("Found agent role, config_file: {:?}", role.config_file);

        let config_file_path = role.config_file.as_ref().ok_or_else(|| {
            ConfigServiceError::io(
                "agent has no config file",
                std::io::Error::new(
                    std::io::ErrorKind::NotFound,
                    format!("agent {} has no config file", name),
                ),
            )
        })?;
        tracing::info!("Config file path: {:?}", config_file_path);

        let content = std::fs::read_to_string(config_file_path)
            .map_err(|e| ConfigServiceError::io("failed to read agent config file", e))?;
        tracing::info!("Read {} bytes from config file", content.len());

        let mut toml_value: toml::Value = toml::from_str(&content)
            .map_err(|e| ConfigServiceError::toml("failed to parse agent config file", e))?;

        if let Some(table) = toml_value.as_table_mut() {
            if let Some(model) = model {
                table.insert("model".to_string(), toml::Value::String(model.to_string()));
            }
            if let Some(instructions) = developer_instructions {
                table.insert(
                    "developer_instructions".to_string(),
                    toml::Value::String(instructions.to_string()),
                );
            }
            if let Some(nicknames) = nickname_candidates {
                let nicknames_value: Vec<toml::Value> = nicknames
                    .iter()
                    .map(|s| toml::Value::String(s.clone()))
                    .collect();
                table.insert(
                    "nickname_candidates".to_string(),
                    toml::Value::Array(nicknames_value),
                );
            }
        }

        let new_content = toml::to_string_pretty(&toml_value).map_err(|e| {
            ConfigServiceError::io(
                "failed to serialize agent config",
                std::io::Error::new(std::io::ErrorKind::InvalidData, e.to_string()),
            )
        })?;

        std::fs::write(config_file_path, &new_content)
            .map_err(|e| ConfigServiceError::io("failed to write agent config file", e))?;
        tracing::info!(
            "Successfully wrote updated config to {}",
            config_file_path.display()
        );

        Ok(AgentUpdateResponse {
            success: true,
            message: Some(format!("Agent {} updated successfully", name)),
        })
    }

    pub async fn agent_create(
        &self,
        id: &str,
        name: Option<&str>,
        description: Option<&str>,
        extends: Option<&str>,
        agent_dir: Option<&str>,
    ) -> Result<AgentCreateResponse, ConfigServiceError> {
        tracing::info!("agent_create called for: {}", id);

        let agents_dir = if let Some(dir) = agent_dir {
            PathBuf::from(dir)
        } else {
            crate::config::find_codex_agents_dir()
                .map_err(|e| ConfigServiceError::io("failed to find codex agents dir", e))?
        };

        let service = super::AgentConfigService::new(agents_dir);

        let config = super::AgentConfig {
            name: name.map(String::from),
            description: description.map(String::from),
            extends: extends.map(String::from).or(Some("main".to_string())),
            model: None,
            reasoning_effort: None,
            developer_instructions: None,
            workspace: None,
            tools: None,
            skills: None,
            subagents: None,
            contacts: None,
        };

        service.save_agent(id, &config).map_err(|e| {
            ConfigServiceError::io(
                "failed to save agent config",
                std::io::Error::other(e.to_string()),
            )
        })?;

        let _ = service.ensure_workspace(id).map_err(|e| {
            tracing::warn!("failed to create workspace: {}", e);
        });

        let agents = service.list_agents().map_err(|e| {
            ConfigServiceError::io(
                "failed to list agents",
                std::io::Error::other(e.to_string()),
            )
        })?;

        let agent_info =
            agents
                .into_iter()
                .find(|a| a.id == id)
                .map(|a| codex_app_server_protocol::AgentInfo {
                    id: a.id,
                    name: a.name,
                    description: a.description,
                    config_file: None,
                    nickname_candidates: None,
                    workspace: a.workspace_path,
                    extends: a.extends,
                    has_workspace: a.has_workspace,
                });

        Ok(AgentCreateResponse {
            success: true,
            message: Some(format!("Agent {} created successfully", id)),
            agent: agent_info,
        })
    }

    pub async fn agent_delete(
        &self,
        id: &str,
        agent_dir: Option<&str>,
    ) -> Result<AgentDeleteResponse, ConfigServiceError> {
        tracing::info!("agent_delete called for: {}", id);

        let agents_dir = if let Some(dir) = agent_dir {
            PathBuf::from(dir)
        } else {
            crate::config::find_codex_agents_dir()
                .map_err(|e| ConfigServiceError::io("failed to find codex agents dir", e))?
        };

        let service = super::AgentConfigService::new(agents_dir);

        service.delete_agent(id).map_err(|e| {
            ConfigServiceError::io(
                "failed to delete agent",
                std::io::Error::other(e.to_string()),
            )
        })?;

        Ok(AgentDeleteResponse {
            success: true,
            message: Some(format!("Agent {} deleted successfully", id)),
        })
    }

    pub async fn agent_list_isolated(
        &self,
        agent_dir: Option<&str>,
    ) -> Result<AgentListResponse, ConfigServiceError> {
        tracing::info!("agent_list_isolated called with agent_dir: {:?}", agent_dir);

        let agents_dir = if let Some(dir) = agent_dir {
            PathBuf::from(dir)
        } else {
            crate::config::find_codex_agents_dir()
                .map_err(|e| ConfigServiceError::io("failed to find codex agents dir", e))?
        };

        let service = super::AgentConfigService::new(agents_dir);

        let agents = service.list_agents().map_err(|e| {
            ConfigServiceError::io(
                "failed to list agents",
                std::io::Error::other(e.to_string()),
            )
        })?;

        let v2_agents: Vec<AgentInfo> = agents
            .into_iter()
            .map(|a| AgentInfo {
                id: a.id,
                name: a.name,
                description: a.description,
                config_file: None,
                nickname_candidates: None,
                workspace: a.workspace_path,
                extends: a.extends,
                has_workspace: a.has_workspace,
            })
            .collect();

        Ok(AgentListResponse { agents: v2_agents })
    }

    pub async fn agent_read_isolated(
        &self,
        id: &str,
        agent_dir: Option<&str>,
    ) -> Result<AgentReadResponse, ConfigServiceError> {
        tracing::info!("agent_read_isolated called for: {}", id);

        let agents_dir = if let Some(dir) = agent_dir {
            PathBuf::from(dir)
        } else {
            crate::config::find_codex_agents_dir()
                .map_err(|e| ConfigServiceError::io("failed to find codex agents dir", e))?
        };

        let service = super::AgentConfigService::new(agents_dir);

        let config = service.load_agent(id).map_err(|e| {
            ConfigServiceError::io("failed to load agent", std::io::Error::other(e.to_string()))
        })?;

        let workspace_path = service.workspace_path(id);
        let has_workspace = workspace_path.exists();

        let config_json =
            serde_json::to_value(&config).unwrap_or(JsonValue::Object(serde_json::Map::new()));

        let workspace_instructions = service.get_workspace_instructions(id).ok();

        Ok(AgentReadResponse {
            id: id.to_string(),
            name: config.name,
            description: config.description,
            config_file: None,
            nickname_candidates: None,
            workspace: if has_workspace {
                Some(workspace_path.to_string_lossy().to_string())
            } else {
                None
            },
            config: config_json,
            model: config.model,
            developer_instructions: config.developer_instructions,
            extends: config.extends,
            has_workspace,
            workspace_instructions,
            tools: config.tools.map(|t| ApiAgentToolsConfig {
                allow: t.allow,
                deny: t.deny,
            }),
            skills: config.skills,
            contacts: config.contacts.map(|c| ApiAgentContactsConfig {
                allow: c.allow,
                deny: c.deny,
            }),
        })
    }

    pub async fn agent_update_isolated(
        &self,
        id: &str,
        agent_dir: Option<&str>,
        name: Option<&str>,
        description: Option<&str>,
        model: Option<&str>,
        developer_instructions: Option<&str>,
        _nickname_candidates: Option<&[String]>,
        extends: Option<&str>,
        workspace: Option<&str>,
        contacts: Option<&ApiAgentContactsConfig>,
    ) -> Result<AgentUpdateResponse, ConfigServiceError> {
        tracing::info!("agent_update_isolated called for: {}", id);

        let agents_dir = if let Some(dir) = agent_dir {
            PathBuf::from(dir)
        } else {
            crate::config::find_codex_agents_dir()
                .map_err(|e| ConfigServiceError::io("failed to find codex agents dir", e))?
        };

        let service = super::AgentConfigService::new(agents_dir);

        let mut config = service.load_agent(id).map_err(|e| {
            ConfigServiceError::io("failed to load agent", std::io::Error::other(e.to_string()))
        })?;

        if name.is_some() {
            config.name = name.map(String::from);
        }
        if description.is_some() {
            config.description = description.map(String::from);
        }
        if model.is_some() {
            config.model = model.map(String::from);
        }
        if developer_instructions.is_some() {
            config.developer_instructions = developer_instructions.map(String::from);
        }
        if extends.is_some() {
            config.extends = extends.map(String::from);
        }
        if workspace.is_some() {
            config.workspace = workspace.map(String::from);
        }
        if let Some(c) = contacts {
            config.contacts = Some(crate::config::agent_config::AgentContactsConfig {
                allow: c.allow.clone(),
                deny: c.deny.clone(),
            });
        }

        service.save_agent(id, &config).map_err(|e| {
            ConfigServiceError::io(
                "failed to save agent config",
                std::io::Error::other(e.to_string()),
            )
        })?;

        Ok(AgentUpdateResponse {
            success: true,
            message: Some(format!("Agent {} updated successfully", id)),
        })
    }

    pub async fn agent_workspace_files(
        &self,
        id: &str,
        agent_dir: Option<&str>,
    ) -> Result<AgentWorkspaceFilesResponse, ConfigServiceError> {
        tracing::info!("agent_workspace_files called for: {}", id);

        let agents_dir = if let Some(dir) = agent_dir {
            PathBuf::from(dir)
        } else {
            crate::config::find_codex_agents_dir()
                .map_err(|e| ConfigServiceError::io("failed to find codex agents dir", e))?
        };

        let service = super::AgentConfigService::new(agents_dir);
        let files = service.list_workspace_files(id);

        Ok(AgentWorkspaceFilesResponse {
            files: files
                .into_iter()
                .map(|(filename, content)| AgentWorkspaceFile { filename, content })
                .collect(),
        })
    }

    pub async fn agent_update_workspace_files(
        &self,
        id: &str,
        agent_dir: Option<&str>,
        files: Vec<AgentWorkspaceFile>,
    ) -> Result<AgentWorkspaceFilesUpdateResponse, ConfigServiceError> {
        tracing::info!("agent_update_workspace_files called for: {}", id);

        let agents_dir = if let Some(dir) = agent_dir {
            PathBuf::from(dir)
        } else {
            crate::config::find_codex_agents_dir()
                .map_err(|e| ConfigServiceError::io("failed to find codex agents dir", e))?
        };

        let service = super::AgentConfigService::new(agents_dir);
        let files: Vec<(String, String)> =
            files.into_iter().map(|f| (f.filename, f.content)).collect();
        service.save_workspace_files(id, files).map_err(|e| {
            ConfigServiceError::io(
                "failed to save workspace files",
                std::io::Error::other(e.to_string()),
            )
        })?;

        Ok(AgentWorkspaceFilesUpdateResponse {
            success: true,
            message: None,
        })
    }

    pub async fn write_value(
        &self,
        params: ConfigValueWriteParams,
    ) -> Result<ConfigWriteResponse, ConfigServiceError> {
        let edits = vec![(params.key_path, params.value, params.merge_strategy)];
        self.apply_edits(params.file_path, params.expected_version, edits)
            .await
    }

    pub async fn batch_write(
        &self,
        params: ConfigBatchWriteParams,
    ) -> Result<ConfigWriteResponse, ConfigServiceError> {
        let edits = params
            .edits
            .into_iter()
            .map(|edit| (edit.key_path, edit.value, edit.merge_strategy))
            .collect();

        self.apply_edits(params.file_path, params.expected_version, edits)
            .await
    }

    pub async fn load_user_saved_config(
        &self,
    ) -> Result<codex_app_server_protocol::UserSavedConfig, ConfigServiceError> {
        let layers = self
            .load_thread_agnostic_config()
            .await
            .map_err(|err| ConfigServiceError::io("failed to load configuration", err))?;

        let toml_value = layers.effective_config();
        let cfg: ConfigToml = toml_value
            .try_into()
            .map_err(|err| ConfigServiceError::toml("failed to parse config.toml", err))?;
        Ok(cfg.into())
    }

    async fn apply_edits(
        &self,
        file_path: Option<String>,
        expected_version: Option<String>,
        edits: Vec<(String, JsonValue, MergeStrategy)>,
    ) -> Result<ConfigWriteResponse, ConfigServiceError> {
        let allowed_path =
            AbsolutePathBuf::resolve_path_against_base(CONFIG_TOML_FILE, &self.codex_home)
                .map_err(|err| ConfigServiceError::io("failed to resolve user config path", err))?;
        let provided_path = match file_path {
            Some(path) => AbsolutePathBuf::from_absolute_path(PathBuf::from(path))
                .map_err(|err| ConfigServiceError::io("failed to resolve user config path", err))?,
            None => allowed_path.clone(),
        };

        if !paths_match(&allowed_path, &provided_path) {
            return Err(ConfigServiceError::write(
                ConfigWriteErrorCode::ConfigLayerReadonly,
                "Only writes to the user config are allowed",
            ));
        }

        let layers = self
            .load_thread_agnostic_config()
            .await
            .map_err(|err| ConfigServiceError::io("failed to load configuration", err))?;
        let user_layer = match layers.get_user_layer() {
            Some(layer) => Cow::Borrowed(layer),
            None => Cow::Owned(create_empty_user_layer(&allowed_path).await?),
        };

        if let Some(expected) = expected_version.as_deref()
            && expected != user_layer.version
        {
            return Err(ConfigServiceError::write(
                ConfigWriteErrorCode::ConfigVersionConflict,
                "Configuration was modified since last read. Fetch latest version and retry.",
            ));
        }

        let mut user_config = user_layer.config.clone();
        let mut parsed_segments = Vec::new();
        let mut config_edits = Vec::new();

        for (key_path, value, strategy) in edits.into_iter() {
            let segments = parse_key_path(&key_path).map_err(|message| {
                ConfigServiceError::write(ConfigWriteErrorCode::ConfigValidationError, message)
            })?;
            let original_value = value_at_path(&user_config, &segments).cloned();
            let parsed_value = parse_value(value).map_err(|message| {
                ConfigServiceError::write(ConfigWriteErrorCode::ConfigValidationError, message)
            })?;

            apply_merge(&mut user_config, &segments, parsed_value.as_ref(), strategy).map_err(
                |err| match err {
                    MergeError::PathNotFound => ConfigServiceError::write(
                        ConfigWriteErrorCode::ConfigPathNotFound,
                        "Path not found",
                    ),
                    MergeError::Validation(message) => ConfigServiceError::write(
                        ConfigWriteErrorCode::ConfigValidationError,
                        message,
                    ),
                },
            )?;

            let updated_value = value_at_path(&user_config, &segments).cloned();
            if original_value != updated_value {
                let edit = match updated_value {
                    Some(value) => ConfigEdit::SetPath {
                        segments: segments.clone(),
                        value: toml_value_to_item(&value).map_err(|err| {
                            ConfigServiceError::anyhow("failed to build config edits", err)
                        })?,
                    },
                    None => ConfigEdit::ClearPath {
                        segments: segments.clone(),
                    },
                };
                config_edits.push(edit);
            }

            parsed_segments.push(segments);
        }

        validate_config(&user_config).map_err(|err| {
            ConfigServiceError::write(
                ConfigWriteErrorCode::ConfigValidationError,
                format!("Invalid configuration: {err}"),
            )
        })?;
        let user_config_toml =
            deserialize_config_toml_with_base(user_config.clone(), &self.codex_home).map_err(
                |err| {
                    ConfigServiceError::write(
                        ConfigWriteErrorCode::ConfigValidationError,
                        format!("Invalid configuration: {err}"),
                    )
                },
            )?;
        validate_explicit_feature_settings_in_config_toml(
            &user_config_toml,
            layers.requirements().feature_requirements.as_ref(),
        )
        .map_err(|err| {
            ConfigServiceError::write(
                ConfigWriteErrorCode::ConfigValidationError,
                format!("Invalid configuration: {err}"),
            )
        })?;
        validate_feature_requirements_in_config_toml(
            &user_config_toml,
            layers.requirements().feature_requirements.as_ref(),
        )
        .map_err(|err| {
            ConfigServiceError::write(
                ConfigWriteErrorCode::ConfigValidationError,
                format!("Invalid configuration: {err}"),
            )
        })?;

        let updated_layers = layers.with_user_config(&provided_path, user_config.clone());
        let effective = updated_layers.effective_config();
        validate_config(&effective).map_err(|err| {
            ConfigServiceError::write(
                ConfigWriteErrorCode::ConfigValidationError,
                format!("Invalid configuration: {err}"),
            )
        })?;

        if !config_edits.is_empty() {
            ConfigEditsBuilder::new(&self.codex_home)
                .with_edits(config_edits)
                .apply()
                .await
                .map_err(|err| ConfigServiceError::anyhow("failed to persist config.toml", err))?;
        }

        let overridden = first_overridden_edit(&updated_layers, &effective, &parsed_segments);
        let status = overridden
            .as_ref()
            .map(|_| WriteStatus::OkOverridden)
            .unwrap_or(WriteStatus::Ok);

        Ok(ConfigWriteResponse {
            status,
            version: updated_layers
                .get_user_layer()
                .ok_or_else(|| {
                    ConfigServiceError::write(
                        ConfigWriteErrorCode::UserLayerNotFound,
                        "user layer not found in updated layers",
                    )
                })?
                .version
                .clone(),
            file_path: provided_path,
            overridden_metadata: overridden,
        })
    }

    /// Loads a "thread-agnostic" config, which means the config layers do not
    /// include any in-repo .codex/ folders because there is no cwd/project root
    /// associated with this query.
    async fn load_thread_agnostic_config(&self) -> std::io::Result<ConfigLayerStack> {
        let cwd: Option<AbsolutePathBuf> = None;
        load_config_layers_state(
            &self.codex_home,
            cwd,
            &self.cli_overrides,
            self.loader_overrides.clone(),
            self.cloud_requirements.clone(),
        )
        .await
    }
}

async fn create_empty_user_layer(
    config_toml: &AbsolutePathBuf,
) -> Result<ConfigLayerEntry, ConfigServiceError> {
    let SymlinkWritePaths {
        read_path,
        write_path,
    } = resolve_symlink_write_paths(config_toml.as_path())
        .map_err(|err| ConfigServiceError::io("failed to resolve user config path", err))?;
    let toml_value = match read_path {
        Some(path) => match tokio::fs::read_to_string(&path).await {
            Ok(contents) => toml::from_str(&contents).map_err(|e| {
                ConfigServiceError::toml("failed to parse existing user config.toml", e)
            })?,
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
                write_empty_user_config(write_path.clone()).await?;
                TomlValue::Table(toml::map::Map::new())
            }
            Err(err) => {
                return Err(ConfigServiceError::io(
                    "failed to read user config.toml",
                    err,
                ));
            }
        },
        None => {
            write_empty_user_config(write_path).await?;
            TomlValue::Table(toml::map::Map::new())
        }
    };
    Ok(ConfigLayerEntry::new(
        ConfigLayerSource::User {
            file: config_toml.clone(),
        },
        toml_value,
    ))
}

async fn write_empty_user_config(write_path: PathBuf) -> Result<(), ConfigServiceError> {
    task::spawn_blocking(move || write_atomically(&write_path, ""))
        .await
        .map_err(|err| ConfigServiceError::anyhow("config persistence task panicked", err.into()))?
        .map_err(|err| ConfigServiceError::io("failed to create empty user config.toml", err))
}

fn parse_value(value: JsonValue) -> Result<Option<TomlValue>, String> {
    if value.is_null() {
        return Ok(None);
    }

    serde_json::from_value::<TomlValue>(value)
        .map(Some)
        .map_err(|err| format!("invalid value: {err}"))
}

fn parse_key_path(path: &str) -> Result<Vec<String>, String> {
    if path.trim().is_empty() {
        return Err("keyPath must not be empty".to_string());
    }
    Ok(path
        .split('.')
        .map(std::string::ToString::to_string)
        .collect())
}

#[derive(Debug)]
enum MergeError {
    PathNotFound,
    Validation(String),
}

fn apply_merge(
    root: &mut TomlValue,
    segments: &[String],
    value: Option<&TomlValue>,
    strategy: MergeStrategy,
) -> Result<bool, MergeError> {
    let Some(value) = value else {
        return clear_path(root, segments);
    };

    let Some((last, parents)) = segments.split_last() else {
        return Err(MergeError::Validation(
            "keyPath must not be empty".to_string(),
        ));
    };

    let mut current = root;

    for segment in parents {
        match current {
            TomlValue::Table(table) => {
                current = table
                    .entry(segment.clone())
                    .or_insert_with(|| TomlValue::Table(toml::map::Map::new()));
            }
            _ => {
                *current = TomlValue::Table(toml::map::Map::new());
                if let TomlValue::Table(table) = current {
                    current = table
                        .entry(segment.clone())
                        .or_insert_with(|| TomlValue::Table(toml::map::Map::new()));
                }
            }
        }
    }

    let table = current.as_table_mut().ok_or_else(|| {
        MergeError::Validation("cannot set value on non-table parent".to_string())
    })?;

    if matches!(strategy, MergeStrategy::Upsert)
        && let Some(existing) = table.get_mut(last)
        && matches!(existing, TomlValue::Table(_))
        && matches!(value, TomlValue::Table(_))
    {
        merge_toml_values(existing, value);
        return Ok(true);
    }

    let changed = table
        .get(last)
        .map(|existing| Some(existing) != Some(value))
        .unwrap_or(true);
    table.insert(last.clone(), value.clone());
    Ok(changed)
}

fn clear_path(root: &mut TomlValue, segments: &[String]) -> Result<bool, MergeError> {
    let Some((last, parents)) = segments.split_last() else {
        return Err(MergeError::Validation(
            "keyPath must not be empty".to_string(),
        ));
    };

    let mut current = root;
    for segment in parents {
        match current {
            TomlValue::Table(table) => {
                current = table.get_mut(segment).ok_or(MergeError::PathNotFound)?;
            }
            _ => return Err(MergeError::PathNotFound),
        }
    }

    let Some(parent) = current.as_table_mut() else {
        return Err(MergeError::PathNotFound);
    };

    Ok(parent.remove(last).is_some())
}

fn toml_value_to_item(value: &TomlValue) -> anyhow::Result<TomlItem> {
    match value {
        TomlValue::Table(table) => {
            let mut table_item = toml_edit::Table::new();
            table_item.set_implicit(false);
            for (key, val) in table {
                table_item.insert(key, toml_value_to_item(val)?);
            }
            Ok(TomlItem::Table(table_item))
        }
        other => Ok(TomlItem::Value(toml_value_to_value(other)?)),
    }
}

fn toml_value_to_value(value: &TomlValue) -> anyhow::Result<toml_edit::Value> {
    match value {
        TomlValue::String(val) => Ok(toml_edit::Value::from(val.clone())),
        TomlValue::Integer(val) => Ok(toml_edit::Value::from(*val)),
        TomlValue::Float(val) => Ok(toml_edit::Value::from(*val)),
        TomlValue::Boolean(val) => Ok(toml_edit::Value::from(*val)),
        TomlValue::Datetime(val) => Ok(toml_edit::Value::from(*val)),
        TomlValue::Array(items) => {
            let mut array = toml_edit::Array::new();
            for item in items {
                array.push(toml_value_to_value(item)?);
            }
            Ok(toml_edit::Value::Array(array))
        }
        TomlValue::Table(table) => {
            let mut inline = toml_edit::InlineTable::new();
            for (key, val) in table {
                inline.insert(key, toml_value_to_value(val)?);
            }
            Ok(toml_edit::Value::InlineTable(inline))
        }
    }
}

fn validate_config(value: &TomlValue) -> Result<(), toml::de::Error> {
    let _: ConfigToml = value.clone().try_into()?;
    Ok(())
}

fn paths_match(expected: impl AsRef<Path>, provided: impl AsRef<Path>) -> bool {
    if let (Ok(expanded_expected), Ok(expanded_provided)) = (
        path_utils::normalize_for_path_comparison(&expected),
        path_utils::normalize_for_path_comparison(&provided),
    ) {
        expanded_expected == expanded_provided
    } else {
        expected.as_ref() == provided.as_ref()
    }
}

fn value_at_path<'a>(root: &'a TomlValue, segments: &[String]) -> Option<&'a TomlValue> {
    let mut current = root;
    for segment in segments {
        match current {
            TomlValue::Table(table) => {
                current = table.get(segment)?;
            }
            TomlValue::Array(items) => {
                let idx = segment.parse::<i64>().ok()?;
                let idx = usize::try_from(idx).ok()?;
                current = items.get(idx)?;
            }
            _ => return None,
        }
    }
    Some(current)
}

fn override_message(layer: &ConfigLayerSource) -> String {
    match layer {
        ConfigLayerSource::Mdm { domain, key: _ } => {
            format!("Overridden by managed policy (MDM): {domain}")
        }
        ConfigLayerSource::System { file } => {
            format!("Overridden by managed config (system): {}", file.display())
        }
        ConfigLayerSource::Project { dot_codex_folder } => format!(
            "Overridden by project config: {}/{CONFIG_TOML_FILE}",
            dot_codex_folder.display(),
        ),
        ConfigLayerSource::SessionFlags => "Overridden by session flags".to_string(),
        ConfigLayerSource::User { file } => {
            format!("Overridden by user config: {}", file.display())
        }
        ConfigLayerSource::LegacyManagedConfigTomlFromFile { file } => {
            format!(
                "Overridden by legacy managed_config.toml: {}",
                file.display()
            )
        }
        ConfigLayerSource::LegacyManagedConfigTomlFromMdm => {
            "Overridden by legacy managed configuration from MDM".to_string()
        }
    }
}

fn compute_override_metadata(
    layers: &ConfigLayerStack,
    effective: &TomlValue,
    segments: &[String],
) -> Option<OverriddenMetadata> {
    let user_value = match layers.get_user_layer() {
        Some(user_layer) => value_at_path(&user_layer.config, segments),
        None => return None,
    };
    let effective_value = value_at_path(effective, segments);

    if user_value.is_some() && user_value == effective_value {
        return None;
    }

    if user_value.is_none() && effective_value.is_none() {
        return None;
    }

    let overriding_layer = find_effective_layer(layers, segments)?;
    let message = override_message(&overriding_layer.name);

    Some(OverriddenMetadata {
        message,
        overriding_layer,
        effective_value: effective_value
            .and_then(|value| serde_json::to_value(value).ok())
            .unwrap_or(JsonValue::Null),
    })
}

fn first_overridden_edit(
    layers: &ConfigLayerStack,
    effective: &TomlValue,
    edits: &[Vec<String>],
) -> Option<OverriddenMetadata> {
    for segments in edits {
        if let Some(meta) = compute_override_metadata(layers, effective, segments) {
            return Some(meta);
        }
    }
    None
}

fn find_effective_layer(
    layers: &ConfigLayerStack,
    segments: &[String],
) -> Option<ConfigLayerMetadata> {
    for layer in layers.layers_high_to_low() {
        if let Some(meta) = value_at_path(&layer.config, segments).map(|_| layer.metadata()) {
            return Some(meta);
        }
    }

    None
}

#[cfg(test)]
#[path = "service_tests.rs"]
mod tests;
