use std::collections::BTreeMap;
use std::collections::HashMap;
use std::path::Path;

use codex_protocol::ThreadId;
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

    #[error("contact `{contact_id}` is missing publicThreadId in contacts.json5")]
    MissingPublicThreadId { contact_id: String },

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
    pub fn add(&mut self, id: String, public_thread_id: ThreadId) {
        self.contacts.insert(
            id.clone(),
            ContactRecord {
                agent_id: id,
                public_thread_id,
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
                    "publicThreadId": r.public_thread_id.to_string(),
                })
            })
            .collect();
        json!({ "contacts": contacts })
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ContactRecord {
    pub agent_id: String,
    pub public_thread_id: ThreadId,
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
    public_thread_id: String,
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
        let file: ContactsFile = json5::from_str(&content)?;
        let mut contacts = BTreeMap::new();

        match file {
            ContactsFile::Object { contacts: entries } => {
                for entry in entries {
                    let public_thread_id =
                        parse_public_thread_id(&entry.public_thread_id, &entry.id)?;
                    contacts.insert(
                        entry.id.clone(),
                        ContactRecord {
                            agent_id: entry.id,
                            public_thread_id,
                        },
                    );
                }
            }
            ContactsFile::LegacyMap(map) => {
                for (agent_id, value) in map {
                    let public_thread_id = match value {
                        JsonValue::String(thread_id) => {
                            parse_public_thread_id(&thread_id, &agent_id)?
                        }
                        JsonValue::Object(mut object) => {
                            let thread_id = object
                                .remove("publicThreadId")
                                .and_then(|value| value.as_str().map(ToOwned::to_owned))
                                .ok_or_else(|| ContactsConfigError::MissingPublicThreadId {
                                    contact_id: agent_id.clone(),
                                })?;
                            parse_public_thread_id(&thread_id, &agent_id)?
                        }
                        _ => {
                            return Err(ContactsConfigError::MissingPublicThreadId {
                                contact_id: agent_id,
                            });
                        }
                    };
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

fn parse_public_thread_id(raw: &str, contact_id: &str) -> Result<ThreadId, ContactsConfigError> {
    ThreadId::from_string(raw).map_err(|source| ContactsConfigError::InvalidPublicThreadId {
        contact_id: contact_id.to_string(),
        source,
    })
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
    fn load_array_without_public_threads_fails() {
        let dir = temp_dir_with_contacts(r#"["coder", "reviewer"]"#);
        let err = ContactsConfig::load(dir.path()).expect_err("load should fail");
        assert!(matches!(err, ContactsConfigError::Parse(_)));
    }

    #[test]
    fn load_structured_contacts_with_public_threads() {
        let dir = temp_dir_with_contacts(
            r#"{
                contacts: [
                    { id: "coder", publicThreadId: "67e55044-10b1-426f-9247-bb680e5fe0c8" },
                    { id: "reviewer", publicThreadId: "67e55044-10b1-426f-9247-bb680e5fe0c9" }
                ]
            }"#,
        );
        let config = ContactsConfig::load(dir.path()).expect("load contacts");
        assert_eq!(
            config
                .get("coder")
                .map(|record| record.public_thread_id.to_string()),
            Some("67e55044-10b1-426f-9247-bb680e5fe0c8".to_string())
        );
        assert_eq!(
            config
                .get("reviewer")
                .map(|record| record.public_thread_id.to_string()),
            Some("67e55044-10b1-426f-9247-bb680e5fe0c9".to_string())
        );
    }

    #[test]
    fn load_legacy_map_requires_public_threads() {
        let dir = temp_dir_with_contacts(
            r#"{
                "coder": "67e55044-10b1-426f-9247-bb680e5fe0c8",
                "reviewer": { "publicThreadId": "67e55044-10b1-426f-9247-bb680e5fe0c9" },
                "planner": true
            }"#,
        );
        let err = ContactsConfig::load(dir.path()).expect_err("load should fail");
        assert!(matches!(
            err,
            ContactsConfigError::MissingPublicThreadId { ref contact_id } if contact_id == "planner"
        ));
    }
}
