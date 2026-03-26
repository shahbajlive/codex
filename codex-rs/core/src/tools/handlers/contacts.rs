use async_trait::async_trait;
use codex_protocol::models::ResponseInputItem;
use serde::Deserialize;
use serde::Serialize;
use serde_json::Value as JsonValue;

use crate::codex::TurnContext;
use crate::contacts::ContactsConfig;
use crate::function_tool::FunctionCallError;
use crate::tools::context::FunctionToolOutput;
use crate::tools::context::ToolInvocation;
use crate::tools::context::ToolOutput;
use crate::tools::context::ToolPayload;
use crate::tools::handlers::parse_arguments;
use crate::tools::registry::ToolHandler;
use crate::tools::registry::ToolKind;

pub(crate) struct Handler;

#[derive(Debug, Deserialize)]
struct ContactsArgs {
    mode: ContactsMode,
    query: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
enum ContactsMode {
    Read,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ContactEntry {
    agent_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ContactsResult {
    current_agent_id: Option<String>,
    contacts: Vec<ContactEntry>,
}

#[async_trait]
impl ToolHandler for Handler {
    type Output = ContactsResult;

    fn kind(&self) -> ToolKind {
        ToolKind::Function
    }

    fn matches_kind(&self, payload: &ToolPayload) -> bool {
        matches!(payload, ToolPayload::Function { .. })
    }

    async fn handle(&self, invocation: ToolInvocation) -> Result<Self::Output, FunctionCallError> {
        let ToolInvocation {
            session,
            turn,
            payload,
            ..
        } = invocation;
        let arguments = function_arguments(payload)?;
        let args: ContactsArgs = parse_arguments(&arguments)?;
        let config = session.get_config().await;
        let contacts = ContactsConfig::load(config.codex_home.as_path()).map_err(to_model_error)?;
        let current_agent_id = current_agent_id(&turn);

        read_contacts(contacts, current_agent_id, args.query).await
    }
}

fn function_arguments(payload: ToolPayload) -> Result<String, FunctionCallError> {
    match payload {
        ToolPayload::Function { arguments } => Ok(arguments),
        _ => Err(FunctionCallError::RespondToModel(
            "contacts handler received unsupported payload".to_string(),
        )),
    }
}

async fn read_contacts(
    contacts: ContactsConfig,
    current_agent_id: Option<String>,
    query: Option<String>,
) -> Result<ContactsResult, FunctionCallError> {
    let query = query.as_deref().map(str::to_lowercase);
    let mut entries = contacts
        .list()
        .into_iter()
        .filter(|agent_id| {
            query
                .as_ref()
                .is_none_or(|query| agent_id.agent_id.to_lowercase().contains(query))
        })
        .map(|contact| ContactEntry {
            agent_id: contact.agent_id,
        })
        .collect::<Vec<_>>();
    entries.sort_by(|left, right| left.agent_id.cmp(&right.agent_id));

    Ok(ContactsResult {
        current_agent_id,
        contacts: entries,
    })
}

fn current_agent_id(turn: &TurnContext) -> Option<String> {
    turn.session_source
        .get_agent_role()
        .or_else(|| turn.agent_id.clone())
}

fn to_model_error(err: impl std::fmt::Display) -> FunctionCallError {
    FunctionCallError::RespondToModel(err.to_string())
}

impl ToolOutput for ContactsResult {
    fn log_preview(&self) -> String {
        serde_json::to_string(self)
            .unwrap_or_else(|err| format!("failed to serialize contacts result: {err}"))
    }

    fn success_for_logging(&self) -> bool {
        true
    }

    fn to_response_item(&self, call_id: &str, payload: &ToolPayload) -> ResponseInputItem {
        let text = serde_json::to_string(self)
            .unwrap_or_else(|err| format!("failed to serialize contacts result: {err}"));
        FunctionToolOutput::from_text(text, Some(true)).to_response_item(call_id, payload)
    }

    fn code_mode_result(&self, _payload: &ToolPayload) -> JsonValue {
        serde_json::to_value(self).unwrap_or_else(|err| JsonValue::String(err.to_string()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::codex::make_session_and_context;
    use crate::protocol::SessionSource;
    use crate::protocol::SubAgentSource;
    use crate::tools::context::ToolInvocation;
    use crate::tools::context::ToolPayload;
    use crate::turn_diff_tracker::TurnDiffTracker;
    use codex_protocol::ThreadId;
    use pretty_assertions::assert_eq;
    use serde_json::json;
    use std::sync::Arc;
    use tokio::sync::Mutex;

    fn invocation(
        session: Arc<crate::codex::Session>,
        turn: Arc<TurnContext>,
        args: serde_json::Value,
    ) -> ToolInvocation {
        ToolInvocation {
            session,
            turn,
            tracker: Arc::new(Mutex::new(TurnDiffTracker::default())),
            call_id: "call-1".to_string(),
            tool_name: "contacts".to_string(),
            tool_namespace: None,
            payload: ToolPayload::Function {
                arguments: args.to_string(),
            },
        }
    }

    #[tokio::test]
    async fn read_mode_returns_agent_id_only() {
        let (session, mut turn) = make_session_and_context().await;
        let config = session.get_config().await;
        std::fs::write(
            config.codex_home.join("contacts.json5"),
            r#"{
                contacts: [
                    { id: "reviewer", publicThreadId: "67e55044-10b1-426f-9247-bb680e5fe0c9" }
                ]
            }"#,
        )
        .expect("contacts file");
        turn.session_source = SessionSource::SubAgent(SubAgentSource::ThreadSpawn {
            parent_thread_id: ThreadId::new(),
            depth: 1,
            agent_nickname: Some("Ada".to_string()),
            agent_role: Some("planner".to_string()),
        });

        let result = Handler
            .handle(invocation(
                Arc::new(session),
                Arc::new(turn),
                json!({ "mode": "read" }),
            ))
            .await
            .expect("read should succeed");

        assert_eq!(result.current_agent_id, Some("planner".to_string()));
        assert_eq!(result.contacts.len(), 1);
        assert_eq!(result.contacts[0].agent_id, "reviewer".to_string());
    }
}
