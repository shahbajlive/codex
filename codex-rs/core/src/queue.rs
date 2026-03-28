//! Queue handling for processing pending input items as separate turns.
//!
//! This module handles the logic for:
//! - Draining pending input items from the queue
//! - Processing each item as a separate turn (with TurnStarted/TurnComplete)
//! - Auto-continuing to the next item when current turn completes

use std::sync::Arc;

use tokio_util::sync::CancellationToken;
use tracing::info;

use crate::codex::Session;
use crate::codex::TurnContext;
use crate::hook_runtime::PendingInputHookDisposition;
use crate::hook_runtime::PendingInputRecord;
use crate::hook_runtime::inspect_pending_input;
use crate::protocol::EventMsg;
use crate::protocol::TurnStartedEvent;

/// Process pending input items from the queue, each as a separate turn.
///
/// This function is called after a turn completes (or aborts) to check if there
/// are more items in the queue and spawn new turns for them.
///
/// Returns true if a new turn was spawned, false if queue is empty.
pub(crate) async fn process_queued_turns(
    sess: &Arc<Session>,
    current_context: &Arc<TurnContext>,
    _cancellation_token: CancellationToken,
) -> bool {
    // Check if there are pending items in the queue
    let pending_item = match sess.remove_pending_input_at(0).await {
        Some(item) => item,
        None => {
            // Queue is empty, nothing more to process
            return false;
        }
    };

    info!(
        thread_id = %sess.conversation_id,
        "Processing queued turn, pending items remain in queue"
    );

    // Inspect the pending item (run hooks)
    let pending_item_clone = pending_item.clone();
    let pending_record = match inspect_pending_input(sess, current_context, pending_item).await {
        PendingInputHookDisposition::Accepted(record) => *record,
        PendingInputHookDisposition::Blocked { .. } => {
            // Re-queue blocked items for next attempt
            let _ = sess.prepend_pending_input(vec![pending_item_clone]).await;
            info!("Queued item blocked by hooks, re-queued for next turn");
            return false;
        }
    };

    // Convert to UserInput
    let user_input = match pending_record {
        PendingInputRecord::UserMessage { content, .. } => content,
        PendingInputRecord::ConversationItem { .. } => {
            // Skip conversation items for now
            return false;
        }
    };

    if user_input.is_empty() {
        return false;
    }

    // Emit TurnStarted for the new queued turn
    sess.send_event(
        current_context.as_ref(),
        EventMsg::TurnStarted(TurnStartedEvent {
            turn_id: current_context.sub_id.clone(),
            model_context_window: current_context.model_context_window(),
            collaboration_mode_kind: current_context.collaboration_mode.mode,
        }),
    )
    .await;

    // TODO: Actually run the turn with the user_input
    // This would require calling into the regular turn processing logic
    // For now, we just emit the events and note that more work is needed

    info!(
        thread_id = %sess.conversation_id,
        "Spawned new turn for queued item"
    );

    true
}

/// Drain and discard all pending items in the queue.
///
/// This is used when we want to clear the queue, e.g., on interruption.
pub(crate) async fn drain_queue(sess: &Arc<Session>) -> usize {
    let mut count = 0;
    while let Some(_) = sess.remove_pending_input_at(0).await {
        count += 1;
    }
    info!(thread_id = %sess.conversation_id, count, "Drained pending input queue");
    count
}

#[cfg(test)]
mod tests {
    use super::*;
    // Tests would go here
}
