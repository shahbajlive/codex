use std::path::Path;
use std::path::PathBuf;
use std::sync::Arc;

use async_trait::async_trait;
use codex_protocol::ThreadId;
use codex_protocol::models::ResponseInputItem;
use codex_protocol::user_input::UserInput;
use serde::Deserialize;
use serde::Serialize;
use serde_json::Value as JsonValue;

use crate::codex::TurnContext;
use crate::config::AgentConfigService;
use crate::contacts::ContactEnvelope;
use crate::contacts::ContactNotification;
use crate::contacts::ContactNotificationKind;
use crate::contacts::ContactsConfig;
use crate::contacts::format_contact_message;
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
    target_id: Option<String>,
    thread_id: Option<String>,
    reply_thread_id: Option<String>,
    message: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
enum ContactsMode {
    Read,
    Send,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum DeliveryKind {
    PublicAddress,
    DirectThread,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ContactEntry {
    agent_id: String,
    public_thread_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ContactsResult {
    current_agent_id: Option<String>,
    contacts: Vec<ContactEntry>,
    delivered: Option<DeliveredMessage>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DeliveredMessage {
    submission_id: String,
    target_id: String,
    target_thread_id: String,
    delivery_kind: DeliveryKind,
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

        match args.mode {
            ContactsMode::Read => read_contacts(contacts, current_agent_id, args.query).await,
            ContactsMode::Send => {
                send_message(
                    session,
                    turn,
                    config.codex_home.clone(),
                    contacts,
                    current_agent_id,
                    args,
                )
                .await
            }
        }
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
            query.as_ref().is_none_or(|query| {
                agent_id.agent_id.to_lowercase().contains(query)
                    || agent_id
                        .public_thread_id
                        .to_string()
                        .to_lowercase()
                        .contains(query)
            })
        })
        .map(|contact| ContactEntry {
            public_thread_id: contact.public_thread_id.to_string(),
            agent_id: contact.agent_id,
        })
        .collect::<Vec<_>>();
    entries.sort_by(|left, right| left.agent_id.cmp(&right.agent_id));

    Ok(ContactsResult {
        current_agent_id,
        contacts: entries,
        delivered: None,
    })
}

async fn send_message(
    session: Arc<crate::codex::Session>,
    turn: Arc<TurnContext>,
    codex_home: PathBuf,
    contacts: ContactsConfig,
    current_agent_id: Option<String>,
    args: ContactsArgs,
) -> Result<ContactsResult, FunctionCallError> {
    let sender_agent_id = current_agent_id.ok_or_else(|| {
        FunctionCallError::RespondToModel(
            "contacts send requires an agent thread with a configured agent role".to_string(),
        )
    })?;
    let target_id = args.target_id.ok_or_else(|| {
        FunctionCallError::RespondToModel("contacts send requires `target_id`".to_string())
    })?;
    let message = args.message.ok_or_else(|| {
        FunctionCallError::RespondToModel("contacts send requires `message`".to_string())
    })?;
    let target_contact = contacts.get(&target_id).ok_or_else(|| {
        FunctionCallError::RespondToModel(format!(
            "unknown contact `{target_id}` in CODEX_HOME/contacts.json5"
        ))
    })?;

    ensure_contact_allowed(codex_home.as_path(), &sender_agent_id, &target_id)?;

    let direct_target_thread_id = args.thread_id.as_deref().map(parse_thread_id).transpose()?;
    let reply_thread_id = args
        .reply_thread_id
        .as_deref()
        .map(parse_thread_id)
        .transpose()?;

    let (target_thread_id, delivery_kind) =
        resolve_delivery_target(target_contact.public_thread_id, direct_target_thread_id);

    let envelope = ContactEnvelope {
        sender_agent_id: sender_agent_id.clone(),
        sender_thread_id: session.conversation_id.to_string(),
        sender_turn_id: turn.sub_id.clone(),
        recipient_agent_id: target_id.clone(),
        reply_thread_id: reply_thread_id.map(|thread_id| thread_id.to_string()),
        message,
    };
    let submission_id = session
        .services
        .agent_control
        .send_input(
            target_thread_id,
            vec![UserInput::Text {
                text: format_contact_message(&envelope).map_err(to_model_error)?,
                text_elements: Vec::new(),
            }],
        )
        .await
        .map_err(|err| FunctionCallError::RespondToModel(err.to_string()))?;

    let _ = session
        .services
        .agent_control
        .inject_contact_notification(
            session.conversation_id,
            ContactNotification {
                kind: ContactNotificationKind::Delivered,
                sender_agent_id: sender_agent_id.clone(),
                recipient_agent_id: target_id.clone(),
                sender_thread_id: session.conversation_id.to_string(),
                recipient_thread_id: target_thread_id.to_string(),
                sender_turn_id: Some(turn.sub_id.clone()),
                status: None,
            },
        )
        .await;

    Ok(ContactsResult {
        current_agent_id: Some(sender_agent_id),
        contacts: Vec::new(),
        delivered: Some(DeliveredMessage {
            submission_id,
            target_id,
            target_thread_id: target_thread_id.to_string(),
            delivery_kind,
        }),
    })
}

fn current_agent_id(turn: &TurnContext) -> Option<String> {
    turn.session_source
        .get_agent_role()
        .or_else(|| turn.agent_id.clone())
}

fn resolve_delivery_target(
    public_thread_id: ThreadId,
    direct_thread_id: Option<ThreadId>,
) -> (ThreadId, DeliveryKind) {
    if let Some(thread_id) = direct_thread_id {
        (thread_id, DeliveryKind::DirectThread)
    } else {
        (public_thread_id, DeliveryKind::PublicAddress)
    }
}

fn parse_thread_id(raw: &str) -> Result<ThreadId, FunctionCallError> {
    ThreadId::from_string(raw).map_err(|err| {
        FunctionCallError::RespondToModel(format!("invalid thread id `{raw}`: {err}"))
    })
}

fn ensure_contact_allowed(
    codex_home: &Path,
    sender_agent_id: &str,
    target_id: &str,
) -> Result<(), FunctionCallError> {
    let service = AgentConfigService::new(codex_home.join("agents"));
    let Ok(resolved) = service.resolve_agent(sender_agent_id) else {
        return Ok(());
    };

    let Some(policy) = resolved.contacts else {
        return Ok(());
    };

    if policy
        .deny
        .as_ref()
        .is_some_and(|deny| deny.iter().any(|entry| entry == target_id))
    {
        return Err(FunctionCallError::RespondToModel(format!(
            "contact `{target_id}` is denied for agent `{sender_agent_id}`"
        )));
    }

    if let Some(allow) = policy.allow
        && !allow.iter().any(|entry| entry == target_id)
    {
        return Err(FunctionCallError::RespondToModel(format!(
            "contact `{target_id}` is not allowed for agent `{sender_agent_id}`"
        )));
    }

    Ok(())
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

    #[test]
    fn format_contact_message_wraps_json_envelope() {
        let text = format_contact_message(&ContactEnvelope {
            sender_agent_id: "planner".to_string(),
            sender_thread_id: ThreadId::new().to_string(),
            sender_turn_id: "turn-1".to_string(),
            recipient_agent_id: "reviewer".to_string(),
            reply_thread_id: Some(ThreadId::new().to_string()),
            message: "hello".to_string(),
        })
        .expect("envelope should serialize");

        assert!(text.starts_with("<contact_message>\n{"));
        assert!(text.contains("\"senderAgentId\": \"planner\""));
        assert!(text.ends_with("\n</contact_message>"));
    }

    #[test]
    fn resolve_delivery_target_prefers_explicit_thread() {
        let public_thread_id = ThreadId::new();
        let direct_thread_id = ThreadId::new();

        let resolved = resolve_delivery_target(public_thread_id, Some(direct_thread_id));

        assert_eq!(resolved, (direct_thread_id, DeliveryKind::DirectThread));
    }

    #[test]
    fn resolve_delivery_target_falls_back_to_public_thread() {
        let public_thread_id = ThreadId::new();

        let resolved = resolve_delivery_target(public_thread_id, None);

        assert_eq!(resolved, (public_thread_id, DeliveryKind::PublicAddress));
    }

    #[tokio::test]
    async fn read_mode_uses_agent_role_for_current_agent_id() {
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
        assert_eq!(
            result.contacts[0].public_thread_id,
            "67e55044-10b1-426f-9247-bb680e5fe0c9".to_string()
        );
        assert_eq!(result.delivered, None);
    }

    #[tokio::test]
    async fn send_mode_requires_agent_role() {
        let (session, turn) = make_session_and_context().await;
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

        let err = Handler
            .handle(invocation(
                Arc::new(session),
                Arc::new(turn),
                json!({
                    "mode": "send",
                    "target_id": "reviewer",
                    "message": "hello"
                }),
            ))
            .await
            .expect_err("send should reject missing agent role");

        assert_eq!(
            err,
            FunctionCallError::RespondToModel(
                "contacts send requires an agent thread with a configured agent role".to_string()
            )
        );
    }

    #[tokio::test]
    async fn send_mode_rejects_camel_case_target_id() {
        let (session, mut turn) = make_session_and_context().await;
        turn.session_source = SessionSource::SubAgent(SubAgentSource::ThreadSpawn {
            parent_thread_id: ThreadId::new(),
            depth: 1,
            agent_nickname: Some("Ada".to_string()),
            agent_role: Some("planner".to_string()),
        });

        let err = Handler
            .handle(invocation(
                Arc::new(session),
                Arc::new(turn),
                json!({
                    "mode": "send",
                    "targetId": "reviewer",
                    "message": "hello"
                }),
            ))
            .await
            .expect_err("send should reject camelCase targetId");

        assert_eq!(
            err,
            FunctionCallError::RespondToModel("contacts send requires `target_id`".to_string())
        );
    }
}
