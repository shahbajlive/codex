use std::collections::BTreeMap;
use std::collections::HashMap;
use std::path::Path;

use serde::Deserialize;
use serde_json::Value as JsonValue;
use thiserror::Error;
use uuid::Error as UuidError;

const CONTACTS_FILENAME: &str = "contacts.json5";

#[derive(Error, Debug)]
pub enum ContactsConfigError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("JSON5 parse error: {0}")]
    Parse(#[from] json5::Error),

    #[error("JSON serialize error: {0}")]
    Serialize(#[from] serde_json::Error),

    #[error("invalid public thread id for contact `{contact_id}`: {source}")]
    InvalidPublicThreadId {
        contact_id: String,
        #[source]
        source: UuidError,
    },
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ContactsConfig {
    contacts: BTreeMap<String, ContactRecord>,
    path: Option<std::path::PathBuf>,
}

impl ContactsConfig {
    pub fn add(&mut self, id: String) {
        self.contacts.insert(
            id.clone(),
            ContactRecord {
                agent_id: id,
                public_thread_id: None,
            },
        );
    }

    pub fn remove(&mut self, id: &str) -> bool {
        self.contacts.remove(id).is_some()
    }

    pub fn set_contacts(&mut self, records: Vec<ContactRecord>) {
        self.contacts.clear();
        for record in records {
            self.contacts.insert(record.agent_id.clone(), record);
        }
    }

    pub fn save(&self) -> Result<(), ContactsConfigError> {
        let Some(path) = &self.path else {
            return Ok(());
        };
        let content = serde_json::to_string_pretty(&self.to_file_format())?;
        std::fs::write(path, content)?;
        Ok(())
    }

    fn to_file_format(&self) -> serde_json::Value {
        use serde_json::json;
        let contacts: Vec<_> = self
            .contacts
            .values()
            .map(|r| {
                json!({
                    "id": r.agent_id,
                    "publicThreadId": r.public_thread_id,
                })
            })
            .collect();
        json!({ "contacts": contacts })
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ContactRecord {
    pub agent_id: String,
    pub public_thread_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize, PartialEq)]
#[serde(untagged)]
enum ContactsFile {
    Object { contacts: Vec<ContactDefinition> },
    LegacyMap(HashMap<String, JsonValue>),
}

#[derive(Debug, Clone, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct ContactDefinition {
    id: String,
    #[serde(default)]
    public_thread_id: Option<String>,
}

impl ContactsConfig {
    pub fn load(codex_home: &Path) -> Result<Self, ContactsConfigError> {
        let path = codex_home.join(CONTACTS_FILENAME);
        if !path.exists() {
            return Ok(Self {
                path: Some(path),
                ..Self::default()
            });
        }

        let content = std::fs::read_to_string(&path)?;
        if content.trim().is_empty() {
            return Ok(Self {
                path: Some(path),
                ..Self::default()
            });
        }
        let file: ContactsFile = json5::from_str(&content)?;
        let mut contacts = BTreeMap::new();

        match file {
            ContactsFile::Object { contacts: entries } => {
                for entry in entries {
                    contacts.insert(
                        entry.id.clone(),
                        ContactRecord {
                            agent_id: entry.id,
                            public_thread_id: entry.public_thread_id,
                        },
                    );
                }
            }
            ContactsFile::LegacyMap(map) => {
                for (agent_id, value) in map {
                    let public_thread_id = value
                        .as_object()
                        .and_then(|object| object.get("publicThreadId"))
                        .and_then(|value| value.as_str())
                        .map(str::to_string);
                    contacts.insert(
                        agent_id.clone(),
                        ContactRecord {
                            agent_id,
                            public_thread_id,
                        },
                    );
                }
            }
        }

        Ok(Self {
            contacts,
            path: Some(path),
        })
    }

    pub fn list(&self) -> Vec<ContactRecord> {
        self.contacts.values().cloned().collect()
    }

    pub fn get(&self, agent_id: &str) -> Option<&ContactRecord> {
        self.contacts.get(agent_id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn temp_dir_with_contacts(content: &str) -> TempDir {
        let dir = TempDir::new().expect("temp dir");
        std::fs::write(dir.path().join(CONTACTS_FILENAME), content).expect("contacts file");
        dir
    }

    #[test]
    fn load_missing_file_returns_empty_config() {
        let dir = TempDir::new().expect("temp dir");
        let config = ContactsConfig::load(dir.path()).expect("load contacts");
        assert!(config.list().is_empty());
    }

    #[test]
    fn load_empty_file_returns_empty_config() {
        let dir = temp_dir_with_contacts("");
        let config = ContactsConfig::load(dir.path()).expect("load contacts");
        assert!(config.list().is_empty());
    }

    #[test]
    fn load_array_without_public_threads() {
        let dir = temp_dir_with_contacts(r#"["coder", "reviewer"]"#);
        let config = ContactsConfig::load(dir.path()).expect("load contacts");
        assert_eq!(config.list().len(), 2);
    }

    #[test]
    fn load_structured_contacts_without_public_threads() {
        let dir = temp_dir_with_contacts(
            r#"{
                contacts: [
                    { id: "coder" },
                    { id: "reviewer" }
                ]
            }"#,
        );
        let config = ContactsConfig::load(dir.path()).expect("load contacts");
        assert!(config.get("coder").is_some());
        assert!(config.get("reviewer").is_some());
    }

    #[test]
    fn load_structured_contacts_with_public_threads() {
        let dir = temp_dir_with_contacts(
            r#"{
                contacts: [
                    { id: "coder", publicThreadId: "67e55044-10b1-426f-9247-bb680e5fe0c8" },
                    { id: "reviewer" }
                ]
            }"#,
        );
        let config = ContactsConfig::load(dir.path()).expect("load contacts");
        assert_eq!(
            config
                .get("coder")
                .and_then(|record| record.public_thread_id.as_deref()),
            Some("67e55044-10b1-426f-9247-bb680e5fe0c8")
        );
    }

    #[test]
    fn load_legacy_map() {
        let dir = temp_dir_with_contacts(
            r#"{
                "coder": "67e55044-10b1-426f-9247-bb680e5fe0c8",
                "reviewer": { "publicThreadId": "67e55044-10b1-426f-9247-bb680e5fe0c9" },
                "planner": true
            }"#,
        );
        let config = ContactsConfig::load(dir.path()).expect("load contacts");
        assert!(config.get("coder").is_some());
        assert!(config.get("reviewer").is_some());
        assert!(config.get("planner").is_some());
    }
}
