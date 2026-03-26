use codex_protocol::ThreadId;
use serde::Deserialize;
use serde::Serialize;

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

impl ContactEnvelope {
    pub(crate) fn sender_thread_id(&self) -> Option<ThreadId> {
        ThreadId::from_string(&self.sender_thread_id).ok()
    }
}
