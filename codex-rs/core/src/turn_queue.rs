//! Turn queue - manages queued user messages for separate turns.
//!
//! This is separate from `pending_input` which handles steer injected during turns.
//! Turn queue persists across app restarts.

use codex_protocol::models::ResponseInputItem;
use serde::Deserialize;
use serde::Serialize;
use std::path::PathBuf;

const TURN_QUEUE_FILENAME: &str = "turn_queue.json";

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct TurnQueue {
    items: Vec<ResponseInputItem>,
}

impl TurnQueue {
    /// Get the file path for the turn queue given the session directory.
    pub fn queue_path(session_dir: &PathBuf) -> PathBuf {
        session_dir.join(TURN_QUEUE_FILENAME)
    }

    /// Load turn queue from a file in the session directory.
    pub async fn load_from_directory(session_dir: &PathBuf) -> Option<Self> {
        let path = Self::queue_path(session_dir);
        if !tokio::fs::try_exists(&path).await.unwrap_or(false) {
            return None;
        }
        let content = tokio::fs::read_to_string(&path).await.ok()?;
        serde_json::from_str(&content).ok()
    }

    /// Save turn queue to a file in the session directory.
    pub async fn save_to_directory(&self, session_dir: &PathBuf) -> std::io::Result<()> {
        let path = Self::queue_path(session_dir);
        if self.items.is_empty() {
            // Remove file if queue is empty
            if tokio::fs::try_exists(&path).await.unwrap_or(false) {
                tokio::fs::remove_file(&path).await?;
            }
            return Ok(());
        }
        let content = serde_json::to_string_pretty(self)?;
        tokio::fs::write(&path, content).await
    }
}

impl TurnQueue {
    pub fn new() -> Self {
        Self { items: Vec::new() }
    }

    pub fn push(&mut self, item: ResponseInputItem) {
        self.items.push(item);
    }

    pub fn pop(&mut self) -> Option<ResponseInputItem> {
        if self.items.is_empty() {
            None
        } else {
            Some(self.items.remove(0))
        }
    }

    pub fn peek(&self) -> Option<&ResponseInputItem> {
        self.items.first()
    }

    pub fn remove_at(&mut self, index: usize) -> Option<ResponseInputItem> {
        if index < self.items.len() {
            Some(self.items.remove(index))
        } else {
            None
        }
    }

    pub fn update_at(&mut self, index: usize, content: String) -> Option<()> {
        if index < self.items.len() {
            // Update the message content - replace with new Message variant
            let new_item = ResponseInputItem::Message {
                role: "user".to_string(),
                content: vec![codex_protocol::models::ContentItem::InputText { text: content }],
            };
            self.items[index] = new_item;
            Some(())
        } else {
            None
        }
    }

    pub fn clear(&mut self) {
        self.items.clear();
    }

    pub fn len(&self) -> usize {
        self.items.len()
    }

    pub fn is_empty(&self) -> bool {
        self.items.is_empty()
    }

    pub fn items(&self) -> &[ResponseInputItem] {
        &self.items
    }

    pub fn from_items(items: Vec<ResponseInputItem>) -> Self {
        Self { items }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_push_pop() {
        let mut queue = TurnQueue::new();
        assert!(queue.is_empty());

        queue.push(ResponseInputItem::Message {
            role: "user".to_string(),
            content: vec![codex_protocol::models::ContentItem::InputText {
                text: "hello".to_string(),
            }],
        });
        assert_eq!(queue.len(), 1);

        let item = queue.pop();
        assert!(item.is_some());
        assert!(queue.is_empty());
    }

    #[test]
    fn test_remove_at() {
        let mut queue = TurnQueue::new();
        queue.push(ResponseInputItem::Message {
            role: "user".to_string(),
            content: vec![codex_protocol::models::ContentItem::InputText {
                text: "1".to_string(),
            }],
        });
        queue.push(ResponseInputItem::Message {
            role: "user".to_string(),
            content: vec![codex_protocol::models::ContentItem::InputText {
                text: "2".to_string(),
            }],
        });
        queue.push(ResponseInputItem::Message {
            role: "user".to_string(),
            content: vec![codex_protocol::models::ContentItem::InputText {
                text: "3".to_string(),
            }],
        });

        // Remove from middle
        let removed = queue.remove_at(1);
        assert!(removed.is_some());
        assert_eq!(queue.len(), 2);

        // Verify order
        if let ResponseInputItem::Message { content, .. } = &queue.items[0] {
            if let codex_protocol::models::ContentItem::InputText { text, .. } = &content[0] {
                assert_eq!(text, "1");
            }
        }
    }

    #[test]
    fn test_update_at() {
        let mut queue = TurnQueue::new();
        queue.push(ResponseInputItem::Message {
            role: "user".to_string(),
            content: vec![codex_protocol::models::ContentItem::InputText {
                text: "original".to_string(),
            }],
        });

        let result = queue.update_at(0, "updated".to_string());
        assert!(result.is_some());

        if let ResponseInputItem::Message { content, .. } = &queue.items[0] {
            if let codex_protocol::models::ContentItem::InputText { text, .. } = &content[0] {
                assert_eq!(text, "updated");
            }
        }
    }
}
