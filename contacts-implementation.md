# Contacts Implementation

## Implemented

- `contacts.json5` is now authoritative for discoverability and contactability.
- Each contact must have `id` and `publicThreadId`.
- If a contact is missing from `contacts.json5`, it cannot be contacted.

## Permission Checks

- The `contacts` tool checks both:
  - global existence in `contacts.json5`
  - per-agent `contacts.allow` / `contacts.deny` from `agent.json5`
- Sending is denied if either check fails.

## Send Behavior

- `thread_id` is optional.
- If `thread_id` is missing, send goes to the target's public thread from `contacts.json5`.
- If `thread_id` is present, send goes directly to that thread.

## Contact Message Transport

- Messages are wrapped in a structured `<contact_message>` envelope.
- The envelope carries:
  - `sender_agent_id`
  - `sender_thread_id`
  - `sender_turn_id`
  - `recipient_agent_id`
  - optional `reply_thread_id`
  - `message`

## Public-Thread System Routing

- When a contact message lands on an agent's public thread, system code intercepts it before normal assistant reasoning.
- If allowed, system:
  - creates a new private thread
  - injects a developer handoff message into that thread
  - forwards the actual user message there
- If not allowed, it is ignored.

## Private-Thread Direct Routing

- If a contact message is sent directly to a private thread, system unwraps it there too.
- The private thread gets:
  - a developer handoff/update message with metadata
  - the clean message body as the actual working input
- Private threads therefore do not keep seeing raw protocol wrappers.

## Sender-Visible Status Events

- Added a new contextual fragment: `contact_notification`.
- This is similar to `subagent_notification`, but dedicated for contacts.
- Sender threads can now see lifecycle notifications like:
  - `delivered`
  - `accepted`
  - `status` updates from the receiver private thread

## Runtime Integration

- Public/direct contact handling is wired into core turn processing before normal task execution.
- Status watching reuses existing thread status machinery through new contact-specific notifications.

## Supporting Core Fixes

- Fixed pre-existing `thread_manager.rs` and `codex.rs` compile issues that were blocking app-server and UI startup.
- `cargo test -p codex-core` now passes.

## Key Files Changed

- `codex-rs/core/src/tools/handlers/contacts.rs`
- `codex-rs/core/src/contacts/config.rs`
- `codex-rs/core/src/contacts/message.rs`
- `codex-rs/core/src/contacts/runtime.rs`
- `codex-rs/core/src/contextual_user_message.rs`
- `codex-rs/core/src/session_prefix.rs`
- `codex-rs/core/src/agent/control.rs`
- `codex-rs/core/src/codex.rs`
- `codex-rs/core/src/codex_thread.rs`
- `codex-rs/core/src/thread_manager.rs`

## Not Done Yet

- UI for contacts on `/agents`
- distinct UI rendering for `contact_notification`
- end-to-end manual verification through the UI

## Note

- The `<system-reminder>` line seen in the CLI is harmless.
- It only indicates the environment switched from planning mode to build mode.
- It is not part of the contacts feature or app logic.
