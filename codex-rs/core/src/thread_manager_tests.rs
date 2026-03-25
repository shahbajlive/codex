use super::*;
use crate::codex::make_session_and_context;
use crate::config::test_config;
use crate::models_manager::collaboration_mode_presets::CollaborationModesConfig;
use crate::models_manager::manager::RefreshStrategy;
use assert_matches::assert_matches;
use codex_protocol::models::ContentItem;
use codex_protocol::models::ReasoningItemReasoningSummary;
use codex_protocol::models::ResponseItem;
use codex_protocol::openai_models::ModelsResponse;
use core_test_support::responses::mount_models_once;
use pretty_assertions::assert_eq;
use std::time::Duration;
use tempfile::tempdir;
use wiremock::MockServer;

fn user_msg(text: &str) -> ResponseItem {
    ResponseItem::Message {
        id: None,
        role: "user".to_string(),
        content: vec![ContentItem::OutputText {
            text: text.to_string(),
        }],
        end_turn: None,
        phase: None,
    }
}
fn assistant_msg(text: &str) -> ResponseItem {
    ResponseItem::Message {
        id: None,
        role: "assistant".to_string(),
        content: vec![ContentItem::OutputText {
            text: text.to_string(),
        }],
        end_turn: None,
        phase: None,
    }
}

#[test]
fn drops_from_last_user_only() {
    let items = [
        user_msg("u1"),
        assistant_msg("a1"),
        assistant_msg("a2"),
        user_msg("u2"),
        assistant_msg("a3"),
        ResponseItem::Reasoning {
            id: "r1".to_string(),
            summary: vec![ReasoningItemReasoningSummary::SummaryText {
                text: "s".to_string(),
            }],
            content: None,
            encrypted_content: None,
        },
        ResponseItem::FunctionCall {
            id: None,
            call_id: "c1".to_string(),
            name: "tool".to_string(),
            namespace: None,
            arguments: "{}".to_string(),
        },
        assistant_msg("a4"),
    ];

    let initial: Vec<RolloutItem> = items
        .iter()
        .cloned()
        .map(RolloutItem::ResponseItem)
        .collect();
    let truncated = truncate_before_nth_user_message(InitialHistory::Forked(initial), 1);
    let got_items = truncated.get_rollout_items();
    let expected_items = vec![
        RolloutItem::ResponseItem(items[0].clone()),
        RolloutItem::ResponseItem(items[1].clone()),
        RolloutItem::ResponseItem(items[2].clone()),
    ];
    assert_eq!(
        serde_json::to_value(&got_items).unwrap(),
        serde_json::to_value(&expected_items).unwrap()
    );

    let initial2: Vec<RolloutItem> = items
        .iter()
        .cloned()
        .map(RolloutItem::ResponseItem)
        .collect();
    let truncated2 = truncate_before_nth_user_message(InitialHistory::Forked(initial2), 2);
    assert_matches!(truncated2, InitialHistory::New);
}

#[tokio::test]
async fn ignores_session_prefix_messages_when_truncating() {
    let (session, turn_context) = make_session_and_context().await;
    let mut items = session.build_initial_context(&turn_context).await;
    items.push(user_msg("feature request"));
    items.push(assistant_msg("ack"));
    items.push(user_msg("second question"));
    items.push(assistant_msg("answer"));

    let rollout_items: Vec<RolloutItem> = items
        .iter()
        .cloned()
        .map(RolloutItem::ResponseItem)
        .collect();

    let truncated = truncate_before_nth_user_message(InitialHistory::Forked(rollout_items), 1);
    let got_items = truncated.get_rollout_items();

    let expected: Vec<RolloutItem> = vec![
        RolloutItem::ResponseItem(items[0].clone()),
        RolloutItem::ResponseItem(items[1].clone()),
        RolloutItem::ResponseItem(items[2].clone()),
        RolloutItem::ResponseItem(items[3].clone()),
    ];

    assert_eq!(
        serde_json::to_value(&got_items).unwrap(),
        serde_json::to_value(&expected).unwrap()
    );
}

#[tokio::test]
async fn shutdown_all_threads_bounded_submits_shutdown_to_every_thread() {
    let temp_dir = tempdir().expect("tempdir");
    let mut config = test_config();
    config.codex_home = temp_dir.path().join("codex-home");
    config.cwd = config.codex_home.clone();
    std::fs::create_dir_all(&config.codex_home).expect("create codex home");

    let manager = ThreadManager::with_models_provider_and_home_for_tests(
        CodexAuth::from_api_key("dummy"),
        config.model_provider.clone(),
        config.codex_home.clone(),
    );
    let thread_1 = manager
        .start_thread(config.clone())
        .await
        .expect("start first thread")
        .thread_id;
    let thread_2 = manager
        .start_thread(config)
        .await
        .expect("start second thread")
        .thread_id;

    let report = manager
        .shutdown_all_threads_bounded(Duration::from_secs(10))
        .await;

    let mut expected_completed = vec![thread_1, thread_2];
    expected_completed.sort_by_key(std::string::ToString::to_string);
    assert_eq!(report.completed, expected_completed);
    assert!(report.submit_failed.is_empty());
    assert!(report.timed_out.is_empty());
    assert!(manager.list_thread_ids().await.is_empty());
}

#[tokio::test]
async fn new_uses_configured_openai_provider_for_model_refresh() {
    let server = MockServer::start().await;
    let models_mock = mount_models_once(&server, ModelsResponse { models: vec![] }).await;

    let temp_dir = tempdir().expect("tempdir");
    let mut config = test_config();
    config.codex_home = temp_dir.path().join("codex-home");
    config.cwd = config.codex_home.clone();
    std::fs::create_dir_all(&config.codex_home).expect("create codex home");
    config.model_catalog = None;
    config
        .model_providers
        .get_mut("openai")
        .expect("openai provider should exist")
        .base_url = Some(server.uri());

    let auth_manager =
        AuthManager::from_auth_for_testing(CodexAuth::create_dummy_chatgpt_auth_for_testing());
    let manager = ThreadManager::new(
        &config,
        auth_manager,
        SessionSource::Exec,
        CollaborationModesConfig::default(),
    );

    let _ = manager.list_models(RefreshStrategy::Online).await;
    assert_eq!(models_mock.requests().len(), 1);
}

#[tokio::test]
async fn start_thread_with_agent_id_uses_agent_tools_and_skills_config() {
    let workspace = tempdir().expect("workspace");
    let agent_dir = workspace
        .path()
        .join(".codex")
        .join("agents")
        .join("developer_lead");
    std::fs::create_dir_all(&agent_dir).expect("create agent dir");
    std::fs::write(
        agent_dir.join("agent.json5"),
        r#"{
  name: "Developer Lead",
  extends: "main",
  model: "agent-model",
  approvalPolicy: "untrusted",
  sandboxMode: "danger-full-access",
  tools: { allow: ["bash"], deny: ["webfetch"] },
  skills: ["skill-a"],
}"#,
    )
    .expect("write agent config");

    let temp_dir = tempdir().expect("tempdir");
    let mut config = test_config();
    config.codex_home = temp_dir.path().join("codex-home");
    config.cwd = workspace.path().to_path_buf();
    std::fs::create_dir_all(&config.codex_home).expect("create codex home");

    let manager = ThreadManager::with_models_provider_and_home_for_tests(
        CodexAuth::from_api_key("dummy"),
        config.model_provider.clone(),
        config.codex_home.clone(),
    );
    let thread = manager
        .start_thread_with_tools_and_service_name(
            config,
            Vec::new(),
            false,
            None,
            None,
            Some("developer_lead".to_string()),
            true,
        )
        .await
        .expect("start thread");

    let snapshot = thread.thread.config_snapshot().await;
    assert_eq!(snapshot.agent_id, Some("developer_lead".to_string()));
    assert_eq!(snapshot.model_provider_id, "openai");
    assert_eq!(snapshot.agent_tools_allow, Some(vec!["bash".to_string()]));
    assert_eq!(
        snapshot.agent_tools_deny,
        Some(vec!["webfetch".to_string()])
    );
    assert_eq!(
        snapshot.agent_skills_allow,
        Some(vec!["skill-a".to_string()])
    );
}

#[tokio::test]
async fn start_thread_with_agent_id_uses_agent_model_provider_override() {
    let workspace = tempdir().expect("workspace");
    let agent_dir = workspace
        .path()
        .join(".codex")
        .join("agents")
        .join("developer_lead");
    std::fs::create_dir_all(&agent_dir).expect("create agent dir");
    std::fs::write(
        agent_dir.join("agent.json5"),
        r#"{
  name: "Developer Lead",
  extends: "main",
  model: "custom-lmstudio/qwen3.5-0.8b",
  modelProvider: "custom-lmstudio"
}"#,
    )
    .expect("write agent config");

    let temp_dir = tempdir().expect("tempdir");
    let mut config = test_config();
    config.codex_home = temp_dir.path().join("codex-home");
    config.cwd = workspace.path().to_path_buf();
    std::fs::create_dir_all(&config.codex_home).expect("create codex home");
    let mut custom_provider = config.model_providers["lmstudio"].clone();
    custom_provider.name = "Custom LM Studio".to_string();
    custom_provider.base_url = Some("http://127.0.0.1:4321/v1".to_string());
    config
        .model_providers
        .insert("custom-lmstudio".to_string(), custom_provider);

    let manager = ThreadManager::with_models_provider_and_home_for_tests(
        CodexAuth::from_api_key("dummy"),
        config.model_provider.clone(),
        config.codex_home.clone(),
    );
    let thread = manager
        .start_thread_with_tools_and_service_name(
            config,
            Vec::new(),
            false,
            None,
            None,
            Some("developer_lead".to_string()),
            true,
        )
        .await
        .expect("start thread");

    let snapshot = thread.thread.config_snapshot().await;
    assert_eq!(snapshot.model_provider_id, "custom-lmstudio");
}

#[tokio::test]
async fn start_thread_with_agent_id_inherits_model_provider_from_extended_agent() {
    let workspace = tempdir().expect("workspace");
    let agents_dir = workspace.path().join(".codex").join("agents");
    let main_agent_dir = agents_dir.join("main");
    let child_agent_dir = agents_dir.join("developer_lead");
    std::fs::create_dir_all(&main_agent_dir).expect("create main agent dir");
    std::fs::create_dir_all(&child_agent_dir).expect("create child agent dir");
    std::fs::write(
        main_agent_dir.join("agent.json5"),
        r#"{
  name: "Main",
  modelProvider: "custom-lmstudio"
}"#,
    )
    .expect("write parent agent config");
    std::fs::write(
        child_agent_dir.join("agent.json5"),
        r#"{
  name: "Developer Lead",
  extends: "main",
  model: "custom-lmstudio/qwen3.5-0.8b"
}"#,
    )
    .expect("write child agent config");

    let temp_dir = tempdir().expect("tempdir");
    let mut config = test_config();
    config.codex_home = temp_dir.path().join("codex-home");
    config.cwd = workspace.path().to_path_buf();
    std::fs::create_dir_all(&config.codex_home).expect("create codex home");
    let mut custom_provider = config.model_providers["lmstudio"].clone();
    custom_provider.name = "Custom LM Studio".to_string();
    custom_provider.base_url = Some("http://127.0.0.1:4321/v1".to_string());
    config
        .model_providers
        .insert("custom-lmstudio".to_string(), custom_provider);

    let manager = ThreadManager::with_models_provider_and_home_for_tests(
        CodexAuth::from_api_key("dummy"),
        config.model_provider.clone(),
        config.codex_home.clone(),
    );
    let thread = manager
        .start_thread_with_tools_and_service_name(
            config,
            Vec::new(),
            false,
            None,
            None,
            Some("developer_lead".to_string()),
            true,
        )
        .await
        .expect("start thread");

    let snapshot = thread.thread.config_snapshot().await;
    assert_eq!(snapshot.model_provider_id, "custom-lmstudio");
}
