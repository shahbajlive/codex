use std::sync::Arc;

use async_trait::async_trait;
use tokio_util::sync::CancellationToken;

use crate::codex::TurnContext;
use crate::codex::run_turn;
use crate::protocol::EventMsg;
use crate::protocol::TurnStartedEvent;
use crate::session_startup_prewarm::SessionStartupPrewarmResolution;
use crate::state::TaskKind;
use codex_protocol::models::ResponseInputItem;
use codex_protocol::user_input::UserInput;
use tracing::Instrument;
use tracing::trace_span;

use super::SessionTask;
use super::SessionTaskContext;

#[derive(Default)]
pub(crate) struct RegularTask;

impl RegularTask {
    pub(crate) fn new() -> Self {
        Self
    }
}

#[async_trait]
impl SessionTask for RegularTask {
    fn kind(&self) -> TaskKind {
        TaskKind::Regular
    }

    fn span_name(&self) -> &'static str {
        "session_task.turn"
    }

    async fn run(
        self: Arc<Self>,
        session: Arc<SessionTaskContext>,
        ctx: Arc<TurnContext>,
        input: Vec<UserInput>,
        cancellation_token: CancellationToken,
    ) -> Option<String> {
        let sess = session.clone_session();
        let run_turn_span = trace_span!("run_turn");

        // Check turn_queue for pending items - each queued item is a separate turn
        // Pop from queue to use as input (takes priority over user-provided input)
        let queue_input: Vec<UserInput> = if let Some(queued_item) = sess.pop_turn_queue().await {
            // Convert ResponseInputItem::Message to UserInput::Text
            match queued_item {
                ResponseInputItem::Message { role: _, content } => {
                    // Extract text from content
                    let text = content
                        .iter()
                        .filter_map(|item| {
                            if let codex_protocol::models::ContentItem::InputText { text } = item {
                                Some(text.clone())
                            } else {
                                None
                            }
                        })
                        .collect::<Vec<_>>()
                        .join("\n");
                    vec![UserInput::Text {
                        text,
                        text_elements: vec![],
                    }]
                }
                _ => input, // Fallback to original input if conversion fails
            }
        } else {
            input
        };

        // Regular turns emit `TurnStarted` inline so first-turn lifecycle does
        // not wait on startup prewarm resolution.
        let event = EventMsg::TurnStarted(TurnStartedEvent {
            turn_id: ctx.sub_id.clone(),
            model_context_window: ctx.model_context_window(),
            collaboration_mode_kind: ctx.collaboration_mode.mode,
        });
        sess.send_event(ctx.as_ref(), event).await;
        sess.set_server_reasoning_included(/*included*/ false).await;
        let prewarmed_client_session = match sess
            .consume_startup_prewarm_for_regular_turn(&cancellation_token)
            .await
        {
            SessionStartupPrewarmResolution::Cancelled => return None,
            SessionStartupPrewarmResolution::Unavailable { .. } => None,
            SessionStartupPrewarmResolution::Ready(prewarmed_client_session) => {
                Some(*prewarmed_client_session)
            }
        };
        run_turn(
            sess,
            ctx,
            queue_input,
            prewarmed_client_session,
            cancellation_token,
        )
        .instrument(run_turn_span)
        .await
    }
}
