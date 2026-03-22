use std::future::Future;
use std::path::Path;
use std::pin::Pin;
use std::sync::Arc;

use codex_protocol::ThreadId;
use codex_protocol::models::DeveloperInstructions;
use codex_protocol::models::ResponseItem;
use codex_protocol::protocol::SessionSource;
use codex_protocol::protocol::SubAgentSource;
use codex_protocol::user_input::UserInput;

use crate::codex::Session;
use crate::codex::TurnContext;
use crate::config::AgentConfigService;
use crate::contacts::ContactEnvelope;
use crate::contacts::ContactNotification;
use crate::contacts::ContactNotificationKind;
use crate::contacts::ContactsConfig;
use crate::tasks::RegularTask;

pub(crate) fn try_handle_public_contact_input<'a>(
    sess: &'a Arc<Session>,
    turn_context: &'a Arc<TurnContext>,
    items: &'a [UserInput],
) -> Pin<Box<dyn Future<Output = bool> + Send + 'a>> {
    Box::pin(async move {
        let Some(recipient_agent_id) = turn_context.session_source.get_agent_role() else {
            return false;
        };
        let Ok(contacts) = ContactsConfig::load(turn_context.config.codex_home.as_path()) else {
            return false;
        };
        let Some(recipient_contact) = contacts.get(&recipient_agent_id) else {
            return false;
        };
        let Some(envelope) = extract_contact_envelope(items) else {
            return false;
        };
        if envelope.recipient_agent_id != recipient_agent_id {
            return true;
        }
        if contacts.get(&envelope.sender_agent_id).is_none() {
            return true;
        }
        if !contact_allowed_for_recipient(
            turn_context.config.codex_home.as_path(),
            &recipient_agent_id,
            &envelope.sender_agent_id,
        ) {
            return true;
        }
        let Some(sender_thread_id) = envelope.sender_thread_id() else {
            return true;
        };

        if recipient_contact.public_thread_id == sess.conversation_id {
            return handle_public_contact_envelope(
                sess,
                turn_context,
                envelope,
                sender_thread_id,
                recipient_agent_id,
            )
            .await;
        }

        handle_direct_contact_envelope(
            sess,
            turn_context,
            envelope,
            sender_thread_id,
            recipient_agent_id,
        )
        .await;
        true
    })
}

async fn handle_public_contact_envelope(
    sess: &Arc<Session>,
    turn_context: &Arc<TurnContext>,
    envelope: ContactEnvelope,
    sender_thread_id: ThreadId,
    recipient_agent_id: String,
) -> bool {
    let private_thread_source = SessionSource::SubAgent(SubAgentSource::ThreadSpawn {
        parent_thread_id: sess.conversation_id,
        depth: current_agent_depth(turn_context.as_ref()) + 1,
        agent_nickname: None,
        agent_role: Some(recipient_agent_id.clone()),
    });
    let Ok(private_thread_id) = sess
        .services
        .agent_control
        .spawn_detached_agent(turn_context.config.as_ref().clone(), private_thread_source)
        .await
    else {
        return true;
    };

    let _ = sess
        .services
        .agent_control
        .inject_developer_message_without_turn(
            private_thread_id,
            build_private_handoff_message(&envelope, private_thread_id),
        )
        .await;

    let accepted_notification = ContactNotification {
        kind: ContactNotificationKind::Accepted,
        sender_agent_id: envelope.sender_agent_id.clone(),
        recipient_agent_id: recipient_agent_id.clone(),
        sender_thread_id: sender_thread_id.to_string(),
        recipient_thread_id: private_thread_id.to_string(),
        sender_turn_id: Some(envelope.sender_turn_id.clone()),
        status: None,
    };
    let _ = sess
        .services
        .agent_control
        .inject_contact_notification(sender_thread_id, accepted_notification)
        .await;

    if sess
        .services
        .agent_control
        .send_input(
            private_thread_id,
            vec![UserInput::Text {
                text: envelope.message,
                text_elements: Vec::new(),
            }],
        )
        .await
        .is_err()
    {
        return true;
    }

    sess.services.agent_control.start_contact_status_watcher(
        private_thread_id,
        sender_thread_id,
        envelope.sender_agent_id,
        recipient_agent_id,
        Some(envelope.sender_turn_id),
    );
    true
}

async fn handle_direct_contact_envelope(
    sess: &Arc<Session>,
    turn_context: &Arc<TurnContext>,
    envelope: ContactEnvelope,
    sender_thread_id: ThreadId,
    recipient_agent_id: String,
) {
    let handoff_message: ResponseItem = DeveloperInstructions::new(build_direct_delivery_message(
        &envelope,
        sess.conversation_id,
    ))
    .into();
    sess.record_conversation_items(turn_context, &[handoff_message])
        .await;
    sess.maybe_emit_unknown_model_warning_for_turn(turn_context.as_ref())
        .await;
    sess.services.agent_control.start_contact_status_watcher(
        sess.conversation_id,
        sender_thread_id,
        envelope.sender_agent_id,
        recipient_agent_id,
        Some(envelope.sender_turn_id.clone()),
    );
    sess.spawn_task(
        Arc::clone(turn_context),
        vec![UserInput::Text {
            text: envelope.message,
            text_elements: Vec::new(),
        }],
        RegularTask::new(),
    )
    .await;
}

fn extract_contact_envelope(items: &[UserInput]) -> Option<ContactEnvelope> {
    let [
        UserInput::Text {
            text,
            text_elements,
        },
    ] = items
    else {
        return None;
    };
    if !text_elements.is_empty() {
        return None;
    }
    crate::contacts::parse_contact_message(text)
}

fn current_agent_depth(turn_context: &TurnContext) -> i32 {
    match &turn_context.session_source {
        SessionSource::SubAgent(SubAgentSource::ThreadSpawn { depth, .. }) => *depth,
        _ => 0,
    }
}

fn contact_allowed_for_recipient(
    codex_home: &Path,
    recipient_agent_id: &str,
    sender_agent_id: &str,
) -> bool {
    let service = AgentConfigService::new(codex_home.join("agents"));
    let Ok(resolved) = service.resolve_agent(recipient_agent_id) else {
        return true;
    };
    let Some(policy) = resolved.contacts else {
        return true;
    };
    if policy
        .deny
        .as_ref()
        .is_some_and(|deny| deny.iter().any(|entry| entry == sender_agent_id))
    {
        return false;
    }
    if let Some(allow) = policy.allow {
        return allow.iter().any(|entry| entry == sender_agent_id);
    }
    true
}

fn build_private_handoff_message(
    envelope: &ContactEnvelope,
    private_thread_id: ThreadId,
) -> String {
    let reply_target = envelope
        .reply_thread_id
        .clone()
        .unwrap_or_else(|| envelope.sender_thread_id.clone());
    format!(
        "System handoff: this private thread continues a contact received on your public contact thread.\n\nSender agent id: {sender_agent_id}\nSender thread id: {sender_thread_id}\nSender turn id: {sender_turn_id}\nReply target thread id: {reply_target}\nYour private thread id: {private_thread_id}\n\nIf you choose to respond, use the contacts tool with `target_id` set to `{sender_agent_id}` and `thread_id` set to `{reply_target}`. To establish this thread as the direct reply channel, include `reply_thread_id` set to `{private_thread_id}` in your response.",
        sender_agent_id = envelope.sender_agent_id,
        sender_thread_id = envelope.sender_thread_id,
        sender_turn_id = envelope.sender_turn_id,
        reply_target = reply_target,
        private_thread_id = private_thread_id,
    )
}

fn build_direct_delivery_message(
    envelope: &ContactEnvelope,
    private_thread_id: ThreadId,
) -> String {
    let reply_target = envelope
        .reply_thread_id
        .clone()
        .unwrap_or_else(|| envelope.sender_thread_id.clone());
    format!(
        "System handoff: a contact message was delivered directly into this private thread.\n\nSender agent id: {sender_agent_id}\nSender thread id: {sender_thread_id}\nSender turn id: {sender_turn_id}\nReply target thread id: {reply_target}\nCurrent private thread id: {private_thread_id}\n\nUse the contacts tool with `target_id` set to `{sender_agent_id}` and `thread_id` set to `{reply_target}` when replying. Include `reply_thread_id` set to `{private_thread_id}` if you want the sender to keep using this private thread.",
        sender_agent_id = envelope.sender_agent_id,
        sender_thread_id = envelope.sender_thread_id,
        sender_turn_id = envelope.sender_turn_id,
        reply_target = reply_target,
        private_thread_id = private_thread_id,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use codex_protocol::ThreadId;

    #[test]
    fn extracts_contact_envelope_from_single_text_input() {
        let envelope = ContactEnvelope {
            sender_agent_id: "planner".to_string(),
            sender_thread_id: ThreadId::new().to_string(),
            sender_turn_id: "turn-1".to_string(),
            recipient_agent_id: "reviewer".to_string(),
            reply_thread_id: None,
            message: "hello".to_string(),
        };
        let text = crate::contacts::format_contact_message(&envelope).expect("serialize envelope");

        let parsed = extract_contact_envelope(&[UserInput::Text {
            text,
            text_elements: Vec::new(),
        }])
        .expect("contact envelope should parse");

        assert_eq!(parsed, envelope);
    }

    #[test]
    fn builds_private_handoff_message_with_reply_thread_override() {
        let private_thread_id = ThreadId::new();
        let reply_thread_id = ThreadId::new();
        let envelope = ContactEnvelope {
            sender_agent_id: "planner".to_string(),
            sender_thread_id: ThreadId::new().to_string(),
            sender_turn_id: "turn-1".to_string(),
            recipient_agent_id: "reviewer".to_string(),
            reply_thread_id: Some(reply_thread_id.to_string()),
            message: "hello".to_string(),
        };

        let handoff = build_private_handoff_message(&envelope, private_thread_id);

        assert!(handoff.contains(&reply_thread_id.to_string()));
        assert!(handoff.contains(&private_thread_id.to_string()));
    }

    #[test]
    fn builds_direct_delivery_message_with_reply_thread_override() {
        let private_thread_id = ThreadId::new();
        let reply_thread_id = ThreadId::new();
        let envelope = ContactEnvelope {
            sender_agent_id: "planner".to_string(),
            sender_thread_id: ThreadId::new().to_string(),
            sender_turn_id: "turn-2".to_string(),
            recipient_agent_id: "reviewer".to_string(),
            reply_thread_id: Some(reply_thread_id.to_string()),
            message: "follow up".to_string(),
        };

        let handoff = build_direct_delivery_message(&envelope, private_thread_id);

        assert!(handoff.contains("delivered directly into this private thread"));
        assert!(handoff.contains(&reply_thread_id.to_string()));
        assert!(handoff.contains(&private_thread_id.to_string()));
    }
}
