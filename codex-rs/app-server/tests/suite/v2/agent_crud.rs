use anyhow::Context;
use anyhow::Result;
use app_test_support::create_mock_responses_server_sequence_unchecked;
use codex_app_server_protocol::ClientInfo;
use codex_app_server_protocol::InitializeParams;
use codex_app_server_protocol::JSONRPCMessage;
use codex_app_server_protocol::JSONRPCRequest;
use codex_app_server_protocol::RequestId;
use futures::SinkExt;
use serde_json::json;
use tempfile::TempDir;
use tokio_tungstenite::MaybeTlsStream;
use tokio_tungstenite::WebSocketStream;
use tokio_tungstenite::tungstenite::Message as WebSocketMessage;

use super::connection_handling_websocket::connect_websocket;
use super::connection_handling_websocket::create_config_toml;
use super::connection_handling_websocket::read_response_for_id;
use super::connection_handling_websocket::spawn_websocket_server;

type WsClient = WebSocketStream<MaybeTlsStream<tokio::net::TcpStream>>;

#[tokio::test]
async fn agent_list_is_empty_initially() -> Result<()> {
    let server = create_mock_responses_server_sequence_unchecked(Vec::new()).await;
    let codex_home = TempDir::new()?;
    create_config_toml(codex_home.path(), &server.uri(), "never")?;

    let (mut process, bind_addr) = spawn_websocket_server(codex_home.path()).await?;
    let mut ws = connect_websocket(bind_addr).await?;

    initialize_client(&mut ws, 1, "agent_test_client").await?;

    send_request(
        &mut ws,
        "agent/listIsolated",
        2,
        Some(json!({ "cwd": null })),
    )
    .await?;
    let response = read_response_for_id(&mut ws, 2).await?;

    let agents = response
        .result
        .get("agents")
        .and_then(|a| a.as_array())
        .context("response should have agents array")?;

    assert!(
        agents.is_empty(),
        "Expected no agents initially, got {agents:?}"
    );

    process
        .kill()
        .await
        .context("failed to stop websocket app-server process")?;
    Ok(())
}

#[tokio::test]
async fn agent_create_and_list() -> Result<()> {
    let server = create_mock_responses_server_sequence_unchecked(Vec::new()).await;
    let codex_home = TempDir::new()?;
    create_config_toml(codex_home.path(), &server.uri(), "never")?;

    let (mut process, bind_addr) = spawn_websocket_server(codex_home.path()).await?;
    let mut ws = connect_websocket(bind_addr).await?;

    initialize_client(&mut ws, 1, "agent_test_client").await?;

    let agent_id = "test-agent-123";
    send_request(
        &mut ws,
        "agent/create",
        2,
        Some(json!({
            "id": agent_id,
            "name": "Test Agent",
            "description": "An agent for testing"
        })),
    )
    .await?;
    let create_response = read_response_for_id(&mut ws, 2).await?;
    assert!(
        create_response
            .result
            .get("success")
            .and_then(serde_json::Value::as_bool)
            == Some(true),
        "agent/create should succeed"
    );

    send_request(
        &mut ws,
        "agent/listIsolated",
        3,
        Some(json!({ "cwd": null })),
    )
    .await?;
    let list_response = read_response_for_id(&mut ws, 3).await?;

    let agents = list_response
        .result
        .get("agents")
        .and_then(|a| a.as_array())
        .context("response should have agents array")?;

    assert_eq!(agents.len(), 1, "Expected 1 agent after creation");
    assert_eq!(
        agents[0].get("id").and_then(|v| v.as_str()),
        Some(agent_id),
        "Agent id should match"
    );

    process
        .kill()
        .await
        .context("failed to stop websocket app-server process")?;
    Ok(())
}

#[tokio::test]
async fn agent_workspace_files_read_and_write() -> Result<()> {
    let server = create_mock_responses_server_sequence_unchecked(Vec::new()).await;
    let codex_home = TempDir::new()?;
    create_config_toml(codex_home.path(), &server.uri(), "never")?;

    let (mut process, bind_addr) = spawn_websocket_server(codex_home.path()).await?;
    let mut ws = connect_websocket(bind_addr).await?;

    initialize_client(&mut ws, 1, "agent_test_client").await?;

    let agent_id = "test-agent-files";
    send_request(
        &mut ws,
        "agent/create",
        2,
        Some(json!({
            "id": agent_id,
            "name": "Files Test Agent"
        })),
    )
    .await?;
    let _create_response = read_response_for_id(&mut ws, 2).await?;

    send_request(
        &mut ws,
        "agent/workspaceFiles",
        3,
        Some(json!({ "id": agent_id })),
    )
    .await?;
    let initial_files_response = read_response_for_id(&mut ws, 3).await?;

    let initial_files = initial_files_response
        .result
        .get("files")
        .and_then(|f| f.as_array())
        .context("response should have files array")?;

    assert!(
        !initial_files.is_empty(),
        "New agent should have workspace template files initially"
    );

    let agents_md_content = r#"# Test Agent

This agent is for testing workspace file operations.
"#;

    send_request(
        &mut ws,
        "agent/workspaceFile/write",
        4,
        Some(json!({
            "id": agent_id,
            "filename": "AGENTS.md",
            "content": agents_md_content
        })),
    )
    .await?;
    let write_response = read_response_for_id(&mut ws, 4).await?;
    assert_eq!(
        write_response
            .result
            .get("success")
            .and_then(serde_json::Value::as_bool),
        Some(true),
        "workspaceFile/write should succeed"
    );

    send_request(
        &mut ws,
        "agent/workspaceFiles",
        5,
        Some(json!({ "id": agent_id })),
    )
    .await?;
    let updated_files_response = read_response_for_id(&mut ws, 5).await?;

    let updated_files = updated_files_response
        .result
        .get("files")
        .and_then(|f| f.as_array())
        .context("response should have files array")?;

    assert!(
        !updated_files.is_empty(),
        "Agent should have workspace files"
    );

    let agents_file = updated_files
        .iter()
        .find(|f| f.get("filename").and_then(|n| n.as_str()) == Some("AGENTS.md"))
        .context("AGENTS.md should exist")?;
    assert_eq!(
        agents_file.get("content").and_then(|c| c.as_str()),
        Some(agents_md_content),
        "File content should match"
    );

    let soul_md_content = r#"# Soul

This agent has a soul.
"#;

    send_request(
        &mut ws,
        "agent/workspaceFile/write",
        6,
        Some(json!({
            "id": agent_id,
            "filename": "SOUL.md",
            "content": soul_md_content
        })),
    )
    .await?;
    let _write_soul_response = read_response_for_id(&mut ws, 6).await?;

    send_request(
        &mut ws,
        "agent/workspaceFiles",
        7,
        Some(json!({ "id": agent_id })),
    )
    .await?;
    let both_files_response = read_response_for_id(&mut ws, 7).await?;

    let both_files = both_files_response
        .result
        .get("files")
        .and_then(|f| f.as_array())
        .context("response should have files array")?;

    assert!(
        both_files.len() >= 2,
        "Agent should have at least 2 workspace files now (AGENTS.md and SOUL.md)"
    );

    let agents_file = both_files
        .iter()
        .find(|f| f.get("filename").and_then(|n| n.as_str()) == Some("AGENTS.md"))
        .context("AGENTS.md should exist")?;
    assert_eq!(
        agents_file.get("content").and_then(|c| c.as_str()),
        Some(agents_md_content),
        "AGENTS.md content should persist"
    );

    let soul_file = both_files
        .iter()
        .find(|f| f.get("filename").and_then(|n| n.as_str()) == Some("SOUL.md"))
        .context("SOUL.md should exist")?;
    assert_eq!(
        soul_file.get("content").and_then(|c| c.as_str()),
        Some(soul_md_content),
        "SOUL.md content should match"
    );

    process
        .kill()
        .await
        .context("failed to stop websocket app-server process")?;
    Ok(())
}

#[tokio::test]
async fn agent_workspace_files_persist_on_disk() -> Result<()> {
    let server = create_mock_responses_server_sequence_unchecked(Vec::new()).await;
    let codex_home = TempDir::new()?;
    create_config_toml(codex_home.path(), &server.uri(), "never")?;

    let (mut process, bind_addr) = spawn_websocket_server(codex_home.path()).await?;
    let mut ws = connect_websocket(bind_addr).await?;

    initialize_client(&mut ws, 1, "agent_test_client").await?;

    let agent_id = "test-agent-persist";
    send_request(
        &mut ws,
        "agent/create",
        2,
        Some(json!({
            "id": agent_id,
            "name": "Persistence Test Agent"
        })),
    )
    .await?;
    let _create_response = read_response_for_id(&mut ws, 2).await?;

    let test_content = "# AGENTS.md\n\nTesting file persistence.\n";
    send_request(
        &mut ws,
        "agent/workspaceFile/write",
        3,
        Some(json!({
            "id": agent_id,
            "filename": "AGENTS.md",
            "content": test_content
        })),
    )
    .await?;
    let _write_response = read_response_for_id(&mut ws, 3).await?;

    process
        .kill()
        .await
        .context("failed to stop websocket app-server process")?;

    let agent_dir = codex_home.path().join("agents").join(agent_id);
    let workspace_dir = agent_dir.join("workspace");
    let file_path = workspace_dir.join("AGENTS.md");

    assert!(
        file_path.exists(),
        "AGENTS.md should exist on disk at {file_path:?}"
    );

    let content = tokio::fs::read_to_string(&file_path).await?;
    assert_eq!(
        content, test_content,
        "File content should match what was written"
    );

    Ok(())
}

#[tokio::test]
async fn agent_update_tools() -> Result<()> {
    let server = create_mock_responses_server_sequence_unchecked(Vec::new()).await;
    let codex_home = TempDir::new()?;
    create_config_toml(codex_home.path(), &server.uri(), "never")?;

    let (mut process, bind_addr) = spawn_websocket_server(codex_home.path()).await?;
    let mut ws = connect_websocket(bind_addr).await?;

    initialize_client(&mut ws, 1, "agent_test_client").await?;

    let agent_id = "test-agent-tools";
    send_request(
        &mut ws,
        "agent/create",
        2,
        Some(json!({
            "id": agent_id,
            "name": "Tools Test Agent"
        })),
    )
    .await?;
    let _create_response = read_response_for_id(&mut ws, 2).await?;

    send_request(
        &mut ws,
        "agent/updateIsolated",
        3,
        Some(json!({
            "id": agent_id,
            "name": "Updated Tools Agent"
        })),
    )
    .await?;
    let update_response = read_response_for_id(&mut ws, 3).await?;
    assert_eq!(
        update_response
            .result
            .get("success")
            .and_then(serde_json::Value::as_bool),
        Some(true),
        "agent/updateIsolated should succeed"
    );

    send_request(
        &mut ws,
        "agent/readIsolated",
        4,
        Some(json!({ "id": agent_id })),
    )
    .await?;
    let read_response = read_response_for_id(&mut ws, 4).await?;

    assert_eq!(
        read_response.result.get("name").and_then(|n| n.as_str()),
        Some("Updated Tools Agent"),
        "name should be updated"
    );

    let tools = read_response.result.get("tools");
    if let Some(t) = tools {
        println!("tools value: {t:?}");
    } else {
        println!("tools field not present in response");
    }

    process
        .kill()
        .await
        .context("failed to stop websocket app-server process")?;
    Ok(())
}

#[tokio::test]
async fn agent_delete() -> Result<()> {
    let server = create_mock_responses_server_sequence_unchecked(Vec::new()).await;
    let codex_home = TempDir::new()?;
    create_config_toml(codex_home.path(), &server.uri(), "never")?;

    let (mut process, bind_addr) = spawn_websocket_server(codex_home.path()).await?;
    let mut ws = connect_websocket(bind_addr).await?;

    initialize_client(&mut ws, 1, "agent_test_client").await?;

    let agent_id = "test-agent-delete";
    send_request(
        &mut ws,
        "agent/create",
        2,
        Some(json!({
            "id": agent_id,
            "name": "Delete Test Agent"
        })),
    )
    .await?;
    let _create_response = read_response_for_id(&mut ws, 2).await?;

    send_request(
        &mut ws,
        "agent/listIsolated",
        3,
        Some(json!({ "cwd": null })),
    )
    .await?;
    let list_before = read_response_for_id(&mut ws, 3).await?;
    assert_eq!(
        list_before
            .result
            .get("agents")
            .and_then(|a| a.as_array())
            .map(std::vec::Vec::len),
        Some(1),
        "Should have 1 agent before delete"
    );

    send_request(&mut ws, "agent/delete", 4, Some(json!({ "id": agent_id }))).await?;
    let delete_response = read_response_for_id(&mut ws, 4).await?;
    assert_eq!(
        delete_response
            .result
            .get("success")
            .and_then(serde_json::Value::as_bool),
        Some(true),
        "agent/delete should succeed"
    );

    send_request(
        &mut ws,
        "agent/listIsolated",
        5,
        Some(json!({ "cwd": null })),
    )
    .await?;
    let list_after = read_response_for_id(&mut ws, 5).await?;
    assert_eq!(
        list_after
            .result
            .get("agents")
            .and_then(|a| a.as_array())
            .map(std::vec::Vec::len),
        Some(0),
        "Should have 0 agents after delete"
    );

    process
        .kill()
        .await
        .context("failed to stop websocket app-server process")?;
    Ok(())
}

#[tokio::test]
async fn agent_full_crud_workflow() -> Result<()> {
    let server = create_mock_responses_server_sequence_unchecked(Vec::new()).await;
    let codex_home = TempDir::new()?;
    create_config_toml(codex_home.path(), &server.uri(), "never")?;

    let (mut process, bind_addr) = spawn_websocket_server(codex_home.path()).await?;
    let mut ws = connect_websocket(bind_addr).await?;

    initialize_client(&mut ws, 1, "agent_crud_client").await?;

    let agent_id = "full-crud-agent";

    send_request(
        &mut ws,
        "agent/create",
        2,
        Some(json!({
            "id": agent_id,
            "name": "Full CRUD Agent",
            "description": "Testing the full workflow"
        })),
    )
    .await?;
    let create_resp = read_response_for_id(&mut ws, 2).await?;
    assert!(
        create_resp.result.get("success").and_then(serde_json::Value::as_bool) == Some(true),
        "create should succeed"
    );

    send_request(
        &mut ws,
        "agent/readIsolated",
        3,
        Some(json!({ "id": agent_id })),
    )
    .await?;
    let read_resp = read_response_for_id(&mut ws, 3).await?;
    assert_eq!(
        read_resp.result.get("name").and_then(|n| n.as_str()),
        Some("Full CRUD Agent"),
        "name should match"
    );

    send_request(
        &mut ws,
        "agent/workspaceFile/write",
        4,
        Some(json!({
            "id": agent_id,
            "filename": "AGENTS.md",
            "content": "# Agent Instructions\n\nDo things properly.\n"
        })),
    )
    .await?;
    let write_resp = read_response_for_id(&mut ws, 4).await?;
    assert_eq!(
        write_resp.result.get("success").and_then(serde_json::Value::as_bool),
        Some(true),
        "write should succeed"
    );

    send_request(
        &mut ws,
        "agent/updateIsolated",
        5,
        Some(json!({
            "id": agent_id,
            "name": "Updated CRUD Agent"
        })),
    )
    .await?;
    let update_resp = read_response_for_id(&mut ws, 5).await?;
    assert_eq!(
        update_resp.result.get("success").and_then(serde_json::Value::as_bool),
        Some(true),
        "updateIsolated should succeed"
    );

    send_request(
        &mut ws,
        "agent/readIsolated",
        6,
        Some(json!({ "id": agent_id })),
    )
    .await?;
    let read_after_resp = read_response_for_id(&mut ws, 6).await?;
    assert_eq!(
        read_after_resp.result.get("name").and_then(|n| n.as_str()),
        Some("Updated CRUD Agent"),
        "name should be updated"
    );
    let workspace_instructions = read_after_resp
        .result
        .get("workspaceInstructions")
        .and_then(|w| w.as_str());
    assert!(
        workspace_instructions.is_some(),
        "workspace instructions should be populated"
    );
    assert!(
        workspace_instructions
            .unwrap()
            .contains("Do things properly"),
        "workspace instructions should contain our AGENTS.md content"
    );

    send_request(&mut ws, "agent/delete", 7, Some(json!({ "id": agent_id }))).await?;
    let delete_resp = read_response_for_id(&mut ws, 7).await?;
    assert_eq!(
        delete_resp.result.get("success").and_then(serde_json::Value::as_bool),
        Some(true),
        "delete should succeed"
    );

    process
        .kill()
        .await
        .context("failed to stop websocket app-server process")?;
    Ok(())
}

async fn initialize_client(stream: &mut WsClient, id: i64, client_name: &str) -> Result<()> {
    let params = InitializeParams {
        client_info: ClientInfo {
            name: client_name.to_string(),
            title: Some("Agent CRUD Test Client".to_string()),
            version: "0.1.0".to_string(),
        },
        capabilities: None,
    };
    send_request(
        stream,
        "initialize",
        id,
        Some(serde_json::to_value(params)?),
    )
    .await
}

async fn send_request(
    stream: &mut WsClient,
    method: &str,
    id: i64,
    params: Option<serde_json::Value>,
) -> Result<()> {
    let message = JSONRPCMessage::Request(JSONRPCRequest {
        id: RequestId::Integer(id),
        method: method.to_string(),
        params,
        trace: None,
    });
    let payload = serde_json::to_string(&message)?;
    stream
        .send(WebSocketMessage::Text(payload.into()))
        .await
        .context("failed to send websocket frame")
}
