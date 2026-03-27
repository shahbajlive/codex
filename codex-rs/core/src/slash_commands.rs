use crate::codex::Session;
use crate::codex::TurnContext;
use codex_protocol::models::ContentItem;
use codex_protocol::models::ResponseItem;
use codex_protocol::protocol::EventMsg;
use codex_protocol::protocol::TurnCompleteEvent;
use codex_protocol::protocol::UserMessageEvent;
use codex_protocol::user_input::UserInput;
use std::sync::Arc;

pub(crate) async fn handle_workspace_slash_command(
    sess: &Arc<Session>,
    turn_context: &Arc<TurnContext>,
    items: &[UserInput],
) -> bool {
    if !is_status_slash_command(items) {
        return false;
    }

    let user_message = items
        .iter()
        .find_map(|item| match item {
            UserInput::Text { text, .. } => Some(text.trim().to_string()),
            _ => None,
        })
        .unwrap_or_else(|| "/status".to_string());

    sess.send_event(
        turn_context.as_ref(),
        EventMsg::UserMessage(UserMessageEvent {
            message: user_message,
            images: None,
            local_images: Vec::new(),
            text_elements: Vec::new(),
        }),
    )
    .await;

    let status_detail = build_status_detail(sess, turn_context.as_ref()).await;
    let system_item = ResponseItem::Message {
        id: None,
        role: "system".to_string(),
        content: vec![ContentItem::InputText {
            text: status_detail,
        }],
        end_turn: Some(true),
        phase: None,
    };

    sess.record_conversation_items(turn_context.as_ref(), &[system_item])
        .await;
    sess.send_event(
        turn_context.as_ref(),
        EventMsg::TurnComplete(TurnCompleteEvent {
            turn_id: turn_context.sub_id.clone(),
            last_agent_message: None,
        }),
    )
    .await;
    true
}

fn is_status_slash_command(items: &[UserInput]) -> bool {
    items.iter().any(
        |item| matches!(item, UserInput::Text { text, .. } if text.trim().starts_with("/status")),
    )
}

async fn build_status_detail(sess: &Arc<Session>, turn_context: &TurnContext) -> String {
    let total_tokens = sess
        .total_token_usage()
        .await
        .map(|usage| usage.total_tokens)
        .unwrap_or(0);

    vec![
        format!(
            "Agent: {}",
            turn_context.agent_id.as_deref().unwrap_or("none")
        ),
        format!("CWD: {}", turn_context.cwd.display()),
        format!("Model: {}", turn_context.model_info.slug),
        format!("Provider: {}", turn_context.provider.name),
        format!(
            "Personality: {}",
            turn_context
                .personality
                .map(|personality| format!("{personality:?}"))
                .unwrap_or_else(|| "default".to_string())
        ),
        format!("Approval: {:?}", turn_context.approval_policy.get()),
        format!("Sandbox: {:?}", turn_context.sandbox_policy.get()),
        format!(
            "Context: {}",
            turn_context
                .model_context_window()
                .map_or_else(|| "unknown".to_string(), |window: i64| window.to_string())
        ),
        format!("Tokens: {total_tokens}"),
    ]
    .join("\n")
}
