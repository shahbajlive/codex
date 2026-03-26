# Contacts Implementation (Updated)

## Overview

The contacts tool provides **agent discovery** only. Communication with peer agents uses the same subagent mechanism.

## contacts.json5

- Contains list of contactable agent IDs
- Each entry only needs `id` (no `publicThreadId` needed anymore)

```json5
{
  contacts: [{ id: "backend_engineer" }, { id: "frontend_engineer" }],
}
```

## How to Collaborate with Peer Agents

### Step 1: Discover available agents

```
contacts read
```

Returns list of available agent IDs.

### Step 2: Spawn peer agent thread

```
spawn_agent agent_type: "frontend_engineer"
```

Creates a new thread where the peer agent runs. Returns `{ agent_id: "thread-xyz-123" }`.

### Step 3: Send messages

```
send_input id: "thread-xyz-123", message: "help with UI"
```

Messages go to the spawned peer agent thread.

### Continue conversation

```
send_input id: "thread-xyz-123", message: "also check the CSS"
```

The thread is persistent - you can continue back-and-forth using the same thread ID.

## Key Points

- No more `<contact_message>` XML envelopes
- No more public thread routing
- Uses same `spawn_agent` and `send_input` tools as subagents
- CollabAgent events (`CollabAgentSpawnEndEvent`, `CollabAgentInteractionEndEvent`) work automatically

## Key Files Changed

- `codex-rs/core/src/tools/handlers/contacts.rs` - read-only mode
- `codex-rs/core/src/contacts/config.rs` - simplified config
- `codex-rs/core/src/contacts/message.rs` - minimal struct kept
- `codex-rs/core/src/contacts/runtime.rs` - removed
- `codex-rs/core/src/contacts/mod.rs` - updated exports
- `ui/src/lib/history.ts` - removed contact message parsing
