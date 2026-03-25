//! Rollout module: persistence and discovery of session rollout files.

use std::path::Path;
use std::path::PathBuf;
use std::sync::LazyLock;

use codex_protocol::protocol::SessionSource;

pub const SESSIONS_SUBDIR: &str = "sessions";
pub const ARCHIVED_SESSIONS_SUBDIR: &str = "archived_sessions";
pub const AGENTS_SUBDIR: &str = "agents";
pub static INTERACTIVE_SESSION_SOURCES: LazyLock<Vec<SessionSource>> = LazyLock::new(|| {
    vec![
        SessionSource::Cli,
        SessionSource::VSCode,
        SessionSource::Custom("atlas".to_string()),
        SessionSource::Custom("chatgpt".to_string()),
    ]
});

pub(crate) mod error;
pub mod list;
pub(crate) mod metadata;
pub(crate) mod policy;
pub mod recorder;
pub(crate) mod session_index;
pub(crate) mod truncation;

pub use codex_protocol::protocol::SessionMeta;
pub(crate) use error::map_session_init_error;
pub use list::find_archived_thread_path_by_id_str;
pub use list::find_thread_path_by_id_str;
#[deprecated(note = "use find_thread_path_by_id_str")]
pub use list::find_thread_path_by_id_str as find_conversation_path_by_id_str;
pub use list::rollout_date_parts;
pub use recorder::RolloutRecorder;
pub use recorder::RolloutRecorderParams;
pub use session_index::append_thread_name;
pub use session_index::find_thread_name_by_id;
pub use session_index::find_thread_path_by_name_str;

pub fn sessions_root_for_agent(codex_home: &Path, agent_id: &str) -> PathBuf {
    codex_home
        .join(AGENTS_SUBDIR)
        .join(agent_id)
        .join(SESSIONS_SUBDIR)
}

pub fn archived_sessions_root_for_agent(codex_home: &Path, agent_id: &str) -> PathBuf {
    codex_home
        .join(AGENTS_SUBDIR)
        .join(agent_id)
        .join(ARCHIVED_SESSIONS_SUBDIR)
}

pub fn owner_agent_id_from_rollout_path(path: &Path) -> Option<String> {
    let mut components = path.components().map(|component| component.as_os_str());
    while let Some(component) = components.next() {
        if component == AGENTS_SUBDIR {
            let agent_id = components.next()?.to_str()?.to_string();
            let scope = components.next()?.to_str()?;
            if scope == SESSIONS_SUBDIR || scope == ARCHIVED_SESSIONS_SUBDIR {
                return Some(agent_id);
            }
        }
    }
    None
}

#[cfg(test)]
pub mod tests;
