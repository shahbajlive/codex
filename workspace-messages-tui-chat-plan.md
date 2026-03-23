# Workspace Messages TUI Parity Plan

## Goal

Make `ui/src/pages/WorkspaceMessagesRoutePage.vue` render the same chat transcript semantics a user would see in Codex TUI when the UI is driven through app-server.

This is a **full parity** project:

- app-server must expose every user-visible turn/chat semantic that `tui_app_server` needs
- web must consume the same semantics
- replayed thread history and live notifications must converge to the same rendered result

## Source of Truth

Use these layers as the contract, in order:

1. `codex-rs/tui` defines the intended chat UX semantics
2. `codex-rs/tui_app_server` defines how those semantics are reconstructed from app-server data
3. `/workspace/messages` should implement the same reconstruction model in the web UI

This means parity work should not be based on the current simplified web transcript model.

## Problem Statement

The current web workspace chat is lossy compared with TUI.

Known gaps:

- interrupted turns are collapsed into `turn/completed` status instead of exposing explicit aborted-turn semantics
- retryable stream errors are rendered into transcript state instead of status-only UI
- committed history and active streaming state are merged into one transcript structure
- interrupted-turn draft restore behavior is missing
- the workspace store can reuse the wrong thread when switching agents
- the web client does not yet reconstruct chat the way `tui_app_server` does

## Parity Contract

App-server should expose all semantics needed by `tui_app_server` to reconstruct user-visible chat behavior.

That does **not** mean exposing terminal rendering details.

It **does** mean exposing every semantic event/state that changes what the user sees in transcript history or live turn state.

Minimum contract for parity:

- turn started
- item started
- item completed
- streaming deltas for assistant / reasoning / plan / command / file-change content
- retryable stream errors distinct from terminal turn errors
- explicit turn aborted notification with abort reason
- turn completed notification
- replayable persisted turn state that maps back to the same visible transcript
- server requests needed for approvals, prompts, dynamic tools, and elicitation flows

## Main Architectural Decision

### Recommendation

Model the web reducer after `codex-rs/tui_app_server` event translation rules, while using app-server protocol as the transport boundary.

### Why

- `tui` is the canonical UX
- `tui_app_server` is the canonical adapter from app-server into TUI semantics
- the web UI needs the same adapter logic, not a second interpretation of raw thread items

## Implementation Plan

## Phase 1 - Document the parity contract

### Objective

Create a concrete mapping from app-server signals to TUI-visible chat outcomes.

### Reference files

- `codex-rs/tui/src/chatwidget.rs`
- `codex-rs/tui_app_server/src/chatwidget.rs`
- `codex-rs/tui_app_server/src/app/app_server_adapter.rs`
- `codex-rs/app-server/src/bespoke_event_handling.rs`
- `codex-rs/app-server-protocol/src/protocol/thread_history.rs`

### Deliverable

A parity matrix covering:

- protocol input
- TUI or `tui_app_server` state transition
- visible transcript effect
- current app-server support
- current web support
- implementation owner: protocol, app-server, reducer, or component

### Required scenarios

- normal completed turn
- retryable stream error during turn
- terminal failed turn
- interrupted turn
- interrupted turn with pending draft restore
- replaced turn
- review-ended turn
- replayed interrupted/failed/completed thread history

## Phase 2 - Extend app-server protocol for missing semantics

### Objective

Expose the same turn lifecycle semantics that `tui_app_server` needs.

### Required changes

- add a v2 notification for explicit aborted turns, recommended name: `turn/aborted`
- include:
  - `threadId`
  - `turnId`
  - `reason`
- keep wire naming in camelCase
- align Rust and TS renames if needed
- export the type into `v2/`

### Primary files

- `codex-rs/app-server-protocol/src/protocol/common.rs`
- `codex-rs/app-server-protocol/src/protocol/v2.rs`

### Notes

- `turn/interrupt` RPC already exists; this phase is about notification parity, not request parity
- prefer adding explicit notification shape instead of overloading `turn/completed`

## Phase 3 - Emit parity notifications from app-server

### Objective

Make live app-server output carry the missing semantics.

### Required changes

- emit `turn/aborted` from `EventMsg::TurnAborted`
- preserve abort reason exactly
- keep `turn/interrupt` request resolution behavior intact
- define and test event ordering relative to `turn/completed`

### Recommended ordering rule

- on interrupted turns, emit `turn/aborted` as the semantic terminal event used by parity clients
- only emit `turn/completed` as needed for thread-state synchronization if current clients require it
- document the ordering clearly in app-server docs/tests

### Primary files

- `codex-rs/app-server/src/bespoke_event_handling.rs`
- `codex-rs/app-server/README.md`

## Phase 4 - Make replay semantics match live semantics

### Objective

Ensure `thread/read` can be reduced into the same visible transcript that live notifications would produce.

### Required changes

- audit `codex-rs/app-server-protocol/src/protocol/thread_history.rs`
- confirm how interrupted, failed, and completed turns persist
- explicitly define how web replay converts stored turn status into TUI-equivalent transcript entries
- use `tui_app_server` replay behavior as the reference

### Important rule

Live and replay must share one reducer path in the web layer, even if they enter through different adapters.

## Phase 5 - Add missing web protocol/client support

### Objective

Make the web client understand the full parity event surface.

### Required changes

- add `turn/aborted` to `ui/src/lib/protocol.ts`
- update notification routing in `ui/src/lib/app-server-client.ts`
- add `interruptTurn(threadId, turnId)` client helper using existing RPC
- keep server-request handling in scope for approval/prompt parity flows

### Primary files

- `ui/src/lib/protocol.ts`
- `ui/src/lib/app-server-client.ts`
- `ui/src/lib/app-server-ws-transport.ts`

## Phase 6 - Replace the web transcript reducer with a parity reducer

### Objective

Stop using the current simplified transcript structure as the source of truth.

### Recommendation

Introduce a new reducer focused on TUI parity rather than extending `ui/src/lib/transcript.ts` in place unless that file can be cleanly repurposed.

### Suggested reducer state

- committed transcript entries
- active turn entry
- running status surface
- retry status surface
- pending draft restore state
- pending server request state

### Semantics to implement

- `turn/started` starts running state but does not force a fake transcript error/success entry
- item deltas mutate active live state
- retryable `error` updates status only
- terminal `error` becomes committed failure content
- `turn/aborted` produces interrupted-turn transcript behavior matching TUI
- `turn/completed` flushes committed turn output and clears active state

### Reference behavior

- `codex-rs/tui/src/chatwidget.rs`
- `codex-rs/tui_app_server/src/chatwidget.rs`
- `codex-rs/tui_app_server/src/app/app_server_adapter.rs`

## Phase 7 - Refactor workspace messages store around parity state

### Objective

Make the store drive the page from parity state instead of raw transcript turns.

### Required changes

- use one reducer path for thread replay and live notifications
- add proper request error handling around `startTurn()` and related calls
- add interrupt action support
- restore composer draft after interrupted turns when parity rules require it
- fix agent-thread ownership logic so one agent cannot accidentally reuse another agent's selected thread

### Primary file

- `ui/src/stores/chat/workspace-messages.ts`

### Specific correctness fix

`ensureSelectedThread()` should resolve thread identity by the selected agent mapping first, not by blindly returning `selectedThreadId`.

## Phase 8 - Update the workspace messages UI to render parity state

### Objective

Render the same chat semantics users expect from TUI, with web-native visuals.

### Render model

- committed history area
- active streaming area
- running status row
- interrupted/failure event rows
- approval/prompt/tool request surfaces
- composer with interrupt affordance during active turns

### Notes

- visual styling can remain web-native
- transcript ordering, state transitions, and content semantics should match TUI behavior

### Primary files

- `ui/src/components/WorkspaceMessagesPage.vue`
- `ui/src/pages/WorkspaceMessagesRoutePage.vue`

## Phase 9 - Add parity-focused tests

### Backend tests

- protocol tests for new `turn/aborted` shape
- app-server tests for interrupt notification emission and ordering
- replay/history tests for interrupted and failed turns

### Web tests

- reducer tests for live + replay convergence
- interrupted turn inserts the same user-visible interruption message semantics as TUI
- retryable stream error does not create committed transcript error content
- terminal failure does create committed failure content
- agent switching never reuses the wrong thread
- interrupt action restores draft when expected

### Reference backend test file

- `codex-rs/app-server/tests/suite/v2/turn_interrupt.rs`

## Phase 10 - Regenerate docs and schemas

### Required work when protocol changes land

- update `codex-rs/app-server/README.md`
- run `just write-app-server-schema`
- update any generated TS/schema artifacts that depend on app-server protocol shape

## Suggested File-Level Worklist

### Protocol and backend

- `codex-rs/app-server-protocol/src/protocol/common.rs`
- `codex-rs/app-server-protocol/src/protocol/v2.rs`
- `codex-rs/app-server/src/bespoke_event_handling.rs`
- `codex-rs/app-server-protocol/src/protocol/thread_history.rs`
- `codex-rs/app-server/tests/suite/v2/turn_interrupt.rs`
- `codex-rs/app-server/README.md`

### Web

- `ui/src/lib/protocol.ts`
- `ui/src/lib/app-server-client.ts`
- `ui/src/lib/app-server-ws-transport.ts`
- `ui/src/lib/transcript.ts` or a new parity reducer module
- `ui/src/stores/chat/workspace-messages.ts`
- `ui/src/stores/chat/workspace-messages.test.ts`
- `ui/src/components/WorkspaceMessagesPage.vue`

## Milestones

### Milestone 1

Protocol and backend parity for interrupted turns:

- `turn/aborted` exists
- app-server emits it with reason
- tests cover ordering and interrupt flow

### Milestone 2

Web reducer parity for core transcript flows:

- completed turns
- interrupted turns
- failed turns
- retryable stream errors
- replay/live convergence

### Milestone 3

Interactive parity for workspace chat:

- interrupt button works
- draft restore works
- approval/prompt flows work through app-server server requests

### Milestone 4

User-visible parity check:

- the same scenario in TUI and `/workspace/messages` yields the same transcript semantics

## Risks

### Replay/live divergence

Mitigation:

- use one canonical reducer for rendered chat semantics

### Overloading `turn/completed`

Mitigation:

- add explicit aborted-turn notification instead of encoding more meaning into completion status

### Web-only interpretation drift

Mitigation:

- use `tui_app_server` adapter behavior as the mapping spec

### Large-scope refactor in the workspace store

Mitigation:

- separate protocol/client changes from reducer changes from component changes

## Success Criteria

The project is done when:

- app-server exposes the semantics required to reconstruct TUI-visible chat behavior
- `/workspace/messages` consumes those semantics without lossy shortcuts
- interrupted, failed, retrying, and replayed turns behave the same way they do in TUI
- a user comparing TUI and the workspace messages page sees the same transcript semantics for the same conversation
