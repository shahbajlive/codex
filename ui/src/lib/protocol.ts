import type { ClientInfo } from "../../../codex-rs/app-server-protocol/schema/typescript/ClientInfo";
import type { InitializeCapabilities } from "../../../codex-rs/app-server-protocol/schema/typescript/InitializeCapabilities";
import type { InitializeResponse } from "../../../codex-rs/app-server-protocol/schema/typescript/InitializeResponse";
import type { AgentInfo } from "../../../codex-rs/app-server-protocol/schema/typescript/v2/AgentInfo";
import type { AgentListResponse } from "../../../codex-rs/app-server-protocol/schema/typescript/v2/AgentListResponse";
import type { AgentReadResponse } from "../../../codex-rs/app-server-protocol/schema/typescript/v2/AgentReadResponse";
import type { AgentUpdateParams } from "../../../codex-rs/app-server-protocol/schema/typescript/v2/AgentUpdateParams";
import type { AgentUpdateResponse } from "../../../codex-rs/app-server-protocol/schema/typescript/v2/AgentUpdateResponse";
import type { AgentMessageDeltaNotification } from "../../../codex-rs/app-server-protocol/schema/typescript/v2/AgentMessageDeltaNotification";
import type { ItemCompletedNotification } from "../../../codex-rs/app-server-protocol/schema/typescript/v2/ItemCompletedNotification";
import type { ItemStartedNotification } from "../../../codex-rs/app-server-protocol/schema/typescript/v2/ItemStartedNotification";
import type { Model } from "../../../codex-rs/app-server-protocol/schema/typescript/v2/Model";
import type { ModelListResponse } from "../../../codex-rs/app-server-protocol/schema/typescript/v2/ModelListResponse";
import type { SkillMetadata } from "../../../codex-rs/app-server-protocol/schema/typescript/v2/SkillMetadata";
import type { SkillsListResponse } from "../../../codex-rs/app-server-protocol/schema/typescript/v2/SkillsListResponse";
import type { SkillsListParams } from "../../../codex-rs/app-server-protocol/schema/typescript/v2/SkillsListParams";
import type { Thread } from "../../../codex-rs/app-server-protocol/schema/typescript/v2/Thread";
import type { ThreadItem } from "../../../codex-rs/app-server-protocol/schema/typescript/v2/ThreadItem";
import type { ThreadListParams } from "../../../codex-rs/app-server-protocol/schema/typescript/v2/ThreadListParams";
import type { ThreadListResponse } from "../../../codex-rs/app-server-protocol/schema/typescript/v2/ThreadListResponse";
import type { ThreadReadParams } from "../../../codex-rs/app-server-protocol/schema/typescript/v2/ThreadReadParams";
import type { ThreadReadResponse } from "../../../codex-rs/app-server-protocol/schema/typescript/v2/ThreadReadResponse";
import type { ThreadResumeParams } from "../../../codex-rs/app-server-protocol/schema/typescript/v2/ThreadResumeParams";
import type { ThreadResumeResponse } from "../../../codex-rs/app-server-protocol/schema/typescript/v2/ThreadResumeResponse";
import type { ThreadStartParams } from "../../../codex-rs/app-server-protocol/schema/typescript/v2/ThreadStartParams";
import type { ThreadStartResponse } from "../../../codex-rs/app-server-protocol/schema/typescript/v2/ThreadStartResponse";
import type { Turn } from "../../../codex-rs/app-server-protocol/schema/typescript/v2/Turn";
import type { TurnCompletedNotification } from "../../../codex-rs/app-server-protocol/schema/typescript/v2/TurnCompletedNotification";
import type { TurnStartedNotification } from "../../../codex-rs/app-server-protocol/schema/typescript/v2/TurnStartedNotification";
import type { TurnStartParams } from "../../../codex-rs/app-server-protocol/schema/typescript/v2/TurnStartParams";
import type { TurnStartResponse } from "../../../codex-rs/app-server-protocol/schema/typescript/v2/TurnStartResponse";
import type { UserInput } from "../../../codex-rs/app-server-protocol/schema/typescript/v2/UserInput";

export type {
  AgentInfo,
  AgentListResponse,
  AgentReadResponse,
  AgentUpdateParams,
  AgentUpdateResponse,
  AgentMessageDeltaNotification,
  ClientInfo,
  InitializeCapabilities,
  InitializeResponse,
  ItemCompletedNotification,
  ItemStartedNotification,
  Model,
  ModelListResponse,
  SkillMetadata,
  SkillsListParams,
  SkillsListResponse,
  Thread,
  ThreadItem,
  ThreadListParams,
  ThreadListResponse,
  ThreadReadParams,
  ThreadReadResponse,
  ThreadResumeParams,
  ThreadResumeResponse,
  ThreadStartParams,
  ThreadStartResponse,
  Turn,
  TurnCompletedNotification,
  TurnStartedNotification,
  TurnStartParams,
  TurnStartResponse,
  UserInput,
};

export type CodexNotification =
  | { method: "thread/started"; params: { thread: Thread } }
  | { method: "turn/started"; params: TurnStartedNotification }
  | { method: "item/started"; params: ItemStartedNotification }
  | { method: "item/completed"; params: ItemCompletedNotification }
  | { method: "item/agentMessage/delta"; params: AgentMessageDeltaNotification }
  | { method: "turn/completed"; params: TurnCompletedNotification };

export type ApprovalPolicy =
  | "untrusted"
  | "on-failure"
  | "on-request"
  | "never";

export type SandboxMode =
  | "read-only"
  | "workspace-write"
  | "danger-full-access";

export type PersonalityMode = "friendly" | "pragmatic" | "none";

export type RpcNotification = {
  method: string;
  params?: unknown;
};
