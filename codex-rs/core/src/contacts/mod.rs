pub mod config;
pub mod message;
pub mod runtime;

pub(crate) use config::ContactsConfig;
pub(crate) use message::ContactEnvelope;
pub(crate) use message::ContactNotification;
pub(crate) use message::ContactNotificationKind;
pub(crate) use message::format_contact_message;
pub(crate) use message::parse_contact_message;
pub(crate) use runtime::try_handle_public_contact_input;
