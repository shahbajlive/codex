use codex_protocol::ThreadId;
use codex_protocol::protocol::AgentStatus;
use serde::Deserialize;
use serde::Serialize;

const CONTACT_MESSAGE_OPEN_TAG: &str = "<contact_message>";
const CONTACT_MESSAGE_CLOSE_TAG: &str = "</contact_message>";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ContactEnvelope {
    pub(crate) sender_agent_id: String,
    pub(crate) sender_thread_id: String,
    pub(crate) sender_turn_id: String,
    pub(crate) recipient_agent_id: String,
    pub(crate) reply_thread_id: Option<String>,
    pub(crate) message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum ContactNotificationKind {
    Delivered,
    Accepted,
    Status,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ContactNotification {
    pub(crate) kind: ContactNotificationKind,
    pub(crate) sender_agent_id: String,
    pub(crate) recipient_agent_id: String,
    pub(crate) sender_thread_id: String,
    pub(crate) recipient_thread_id: String,
    pub(crate) sender_turn_id: Option<String>,
    pub(crate) status: Option<AgentStatus>,
}

impl ContactEnvelope {
    pub(crate) fn sender_thread_id(&self) -> Option<ThreadId> {
        ThreadId::from_string(&self.sender_thread_id).ok()
    }
}

pub(crate) fn format_contact_message(
    envelope: &ContactEnvelope,
) -> Result<String, serde_json::Error> {
    let payload = serde_json::to_string_pretty(envelope)?;
    Ok(format!(
        "{CONTACT_MESSAGE_OPEN_TAG}\n{payload}\n{CONTACT_MESSAGE_CLOSE_TAG}"
    ))
}

pub(crate) fn parse_contact_message(text: &str) -> Option<ContactEnvelope> {
    let body = text
        .strip_prefix(CONTACT_MESSAGE_OPEN_TAG)?
        .strip_suffix(CONTACT_MESSAGE_CLOSE_TAG)?
        .trim();
    serde_json::from_str(body).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_contact_message() {
        let envelope = ContactEnvelope {
            sender_agent_id: "planner".to_string(),
            sender_thread_id: ThreadId::new().to_string(),
            sender_turn_id: "turn-1".to_string(),
            recipient_agent_id: "reviewer".to_string(),
            reply_thread_id: Some(ThreadId::new().to_string()),
            message: "hello".to_string(),
        };

        let serialized = format_contact_message(&envelope).expect("serialize envelope");
        let parsed = parse_contact_message(&serialized).expect("parse envelope");

        assert_eq!(parsed, envelope);
    }
}
