import type { ClientInfo } from "../../../codex-rs/app-server-protocol/schema/typescript/ClientInfo";
import type { InitializeCapabilities } from "../../../codex-rs/app-server-protocol/schema/typescript/InitializeCapabilities";
import type { InitializeResponse } from "../../../codex-rs/app-server-protocol/schema/typescript/InitializeResponse";
import type { AgentInfo } from "../../../codex-rs/app-server-protocol/schema/typescript/v2/AgentInfo";
import type { AgentListResponse } from "../../../codex-rs/app-server-protocol/schema/typescript/v2/AgentListResponse";
import type { AgentReadResponse } from "../../../codex-rs/app-server-protocol/schema/typescript/v2/AgentReadResponse";
import type { AgentUpdateParams } from "../../../codex-rs/app-server-protocol/schema/typescript/v2/AgentUpdateParams";
import type { AgentUpdateResponse } from "../../../codex-rs/app-server-protocol/schema/typescript/v2/AgentUpdateResponse";
import type { AgentContactsConfig } from "../../../codex-rs/app-server-protocol/schema/typescript/v2/AgentContactsConfig";
import type { AgentMessageDeltaNotification } from "../../../codex-rs/app-server-protocol/schema/typescript/v2/AgentMessageDeltaNotification";
import type { CommandExecutionApprovalDecision } from "../../../codex-rs/app-server-protocol/schema/typescript/v2/CommandExecutionApprovalDecision";
import type { CommandExecutionRequestApprovalParams } from "../../../codex-rs/app-server-protocol/schema/typescript/v2/CommandExecutionRequestApprovalParams";
import type { CommandExecutionRequestApprovalResponse } from "../../../codex-rs/app-server-protocol/schema/typescript/v2/CommandExecutionRequestApprovalResponse";
import type { CommandExecutionOutputDeltaNotification } from "../../../codex-rs/app-server-protocol/schema/typescript/v2/CommandExecutionOutputDeltaNotification";
import type { ContactCreateParams } from "../../../codex-rs/app-server-protocol/schema/typescript/v2/ContactCreateParams";
import type { ContactDeleteParams } from "../../../codex-rs/app-server-protocol/schema/typescript/v2/ContactDeleteParams";
import type { ContactListResponse } from "../../../codex-rs/app-server-protocol/schema/typescript/v2/ContactListResponse";
import type { Config } from "../../../codex-rs/app-server-protocol/schema/typescript/v2/Config";
import type { ConfigProviderInfo } from "../../../codex-rs/app-server-protocol/schema/typescript/v2/ConfigProviderInfo";
import type { ConfigProvidersResponse } from "../../../codex-rs/app-server-protocol/schema/typescript/v2/ConfigProvidersResponse";
import type { ConfigReadParams } from "../../../codex-rs/app-server-protocol/schema/typescript/v2/ConfigReadParams";
import type { ConfigReadResponse } from "../../../codex-rs/app-server-protocol/schema/typescript/v2/ConfigReadResponse";
import type { DynamicToolCallOutputContentItem } from "../../../codex-rs/app-server-protocol/schema/typescript/v2/DynamicToolCallOutputContentItem";
import type { DynamicToolCallParams } from "../../../codex-rs/app-server-protocol/schema/typescript/v2/DynamicToolCallParams";
import type { DynamicToolCallResponse } from "../../../codex-rs/app-server-protocol/schema/typescript/v2/DynamicToolCallResponse";
import type { ErrorNotification } from "../../../codex-rs/app-server-protocol/schema/typescript/v2/ErrorNotification";
import type { FileChangeApprovalDecision } from "../../../codex-rs/app-server-protocol/schema/typescript/v2/FileChangeApprovalDecision";
import type { FileChangeRequestApprovalParams } from "../../../codex-rs/app-server-protocol/schema/typescript/v2/FileChangeRequestApprovalParams";
import type { FileChangeRequestApprovalResponse } from "../../../codex-rs/app-server-protocol/schema/typescript/v2/FileChangeRequestApprovalResponse";
import type { FileChangeOutputDeltaNotification } from "../../../codex-rs/app-server-protocol/schema/typescript/v2/FileChangeOutputDeltaNotification";
import type { GrantedPermissionProfile } from "../../../codex-rs/app-server-protocol/schema/typescript/v2/GrantedPermissionProfile";
import type { ItemCompletedNotification } from "../../../codex-rs/app-server-protocol/schema/typescript/v2/ItemCompletedNotification";
import type { ItemStartedNotification } from "../../../codex-rs/app-server-protocol/schema/typescript/v2/ItemStartedNotification";
import type { Model } from "../../../codex-rs/app-server-protocol/schema/typescript/v2/Model";
import type { ModelListResponse } from "../../../codex-rs/app-server-protocol/schema/typescript/v2/ModelListResponse";
import type { McpElicitationSchema } from "../../../codex-rs/app-server-protocol/schema/typescript/v2/McpElicitationSchema";
import type { McpServerElicitationAction } from "../../../codex-rs/app-server-protocol/schema/typescript/v2/McpServerElicitationAction";
import type { McpServerElicitationRequestParams } from "../../../codex-rs/app-server-protocol/schema/typescript/v2/McpServerElicitationRequestParams";
import type { McpServerElicitationRequestResponse } from "../../../codex-rs/app-server-protocol/schema/typescript/v2/McpServerElicitationRequestResponse";
import type { PermissionGrantScope } from "../../../codex-rs/app-server-protocol/schema/typescript/v2/PermissionGrantScope";
import type { PermissionsRequestApprovalParams } from "../../../codex-rs/app-server-protocol/schema/typescript/v2/PermissionsRequestApprovalParams";
import type { PermissionsRequestApprovalResponse } from "../../../codex-rs/app-server-protocol/schema/typescript/v2/PermissionsRequestApprovalResponse";
import type { PlanDeltaNotification } from "../../../codex-rs/app-server-protocol/schema/typescript/v2/PlanDeltaNotification";
import type { ReasoningSummaryPartAddedNotification } from "../../../codex-rs/app-server-protocol/schema/typescript/v2/ReasoningSummaryPartAddedNotification";
import type { ReasoningSummaryTextDeltaNotification } from "../../../codex-rs/app-server-protocol/schema/typescript/v2/ReasoningSummaryTextDeltaNotification";
import type { ReasoningTextDeltaNotification } from "../../../codex-rs/app-server-protocol/schema/typescript/v2/ReasoningTextDeltaNotification";
import type { RequestPermissionProfile } from "../../../codex-rs/app-server-protocol/schema/typescript/v2/RequestPermissionProfile";
import type { SkillMetadata } from "../../../codex-rs/app-server-protocol/schema/typescript/v2/SkillMetadata";
import type { SkillsListResponse } from "../../../codex-rs/app-server-protocol/schema/typescript/v2/SkillsListResponse";
import type { SkillsListParams } from "../../../codex-rs/app-server-protocol/schema/typescript/v2/SkillsListParams";
import type { TerminalInteractionNotification } from "../../../codex-rs/app-server-protocol/schema/typescript/v2/TerminalInteractionNotification";
import type { Thread } from "../../../codex-rs/app-server-protocol/schema/typescript/v2/Thread";
import type { ThreadItem } from "../../../codex-rs/app-server-protocol/schema/typescript/v2/ThreadItem";
import type { ThreadListParams } from "../../../codex-rs/app-server-protocol/schema/typescript/v2/ThreadListParams";
import type { ThreadListResponse } from "../../../codex-rs/app-server-protocol/schema/typescript/v2/ThreadListResponse";
import type { ThreadPendingInputDeleteParams } from "../../../codex-rs/app-server-protocol/schema/typescript/v2/ThreadPendingInputDeleteParams";
import type { ThreadPendingInputDeleteResponse } from "../../../codex-rs/app-server-protocol/schema/typescript/v2/ThreadPendingInputDeleteResponse";
import type { ThreadPendingInputItem } from "../../../codex-rs/app-server-protocol/schema/typescript/v2/ThreadPendingInputItem";
import type { ThreadPendingInputReadParams } from "../../../codex-rs/app-server-protocol/schema/typescript/v2/ThreadPendingInputReadParams";
import type { ThreadPendingInputReadResponse } from "../../../codex-rs/app-server-protocol/schema/typescript/v2/ThreadPendingInputReadResponse";
import type { ThreadPendingInputUpdatedNotification } from "../../../codex-rs/app-server-protocol/schema/typescript/v2/ThreadPendingInputUpdatedNotification";
import type { ThreadReadParams } from "../../../codex-rs/app-server-protocol/schema/typescript/v2/ThreadReadParams";
import type { ThreadReadResponse } from "../../../codex-rs/app-server-protocol/schema/typescript/v2/ThreadReadResponse";
import type { ThreadResumeParams } from "../../../codex-rs/app-server-protocol/schema/typescript/v2/ThreadResumeParams";
import type { ThreadResumeResponse } from "../../../codex-rs/app-server-protocol/schema/typescript/v2/ThreadResumeResponse";
import type { ThreadStartParams } from "../../../codex-rs/app-server-protocol/schema/typescript/v2/ThreadStartParams";
import type { ThreadStartResponse } from "../../../codex-rs/app-server-protocol/schema/typescript/v2/ThreadStartResponse";
import type { ThreadTokenUsage } from "../../../codex-rs/app-server-protocol/schema/typescript/v2/ThreadTokenUsage";
import type { ThreadTokenUsageUpdatedNotification } from "../../../codex-rs/app-server-protocol/schema/typescript/v2/ThreadTokenUsageUpdatedNotification";
import type { ThreadTurnQueueItem } from "../../../codex-rs/app-server-protocol/schema/typescript/v2/ThreadTurnQueueItem";
import type { ThreadTurnQueueReadResponse } from "../../../codex-rs/app-server-protocol/schema/typescript/v2/ThreadTurnQueueReadResponse";
import type { ThreadTurnQueueDeleteResponse } from "../../../codex-rs/app-server-protocol/schema/typescript/v2/ThreadTurnQueueDeleteResponse";
import type { ThreadTurnQueueUpdateResponse } from "../../../codex-rs/app-server-protocol/schema/typescript/v2/ThreadTurnQueueUpdateResponse";
import type { ThreadTurnQueueUpdatedNotification } from "../../../codex-rs/app-server-protocol/schema/typescript/v2/ThreadTurnQueueUpdatedNotification";
import type { Turn } from "../../../codex-rs/app-server-protocol/schema/typescript/v2/Turn";
import type { TurnAbortedNotification } from "../../../codex-rs/app-server-protocol/schema/typescript/v2/TurnAbortedNotification";
import type { TurnCompletedNotification } from "../../../codex-rs/app-server-protocol/schema/typescript/v2/TurnCompletedNotification";
import type { TurnDiffUpdatedNotification } from "../../../codex-rs/app-server-protocol/schema/typescript/v2/TurnDiffUpdatedNotification";
import type { TurnPlanUpdatedNotification } from "../../../codex-rs/app-server-protocol/schema/typescript/v2/TurnPlanUpdatedNotification";
import type { TurnStartedNotification } from "../../../codex-rs/app-server-protocol/schema/typescript/v2/TurnStartedNotification";
import type { TurnStartParams } from "../../../codex-rs/app-server-protocol/schema/typescript/v2/TurnStartParams";
import type { TurnStartResponse } from "../../../codex-rs/app-server-protocol/schema/typescript/v2/TurnStartResponse";
import type { ToolRequestUserInputAnswer } from "../../../codex-rs/app-server-protocol/schema/typescript/v2/ToolRequestUserInputAnswer";
import type { ToolRequestUserInputOption } from "../../../codex-rs/app-server-protocol/schema/typescript/v2/ToolRequestUserInputOption";
import type { ToolRequestUserInputParams } from "../../../codex-rs/app-server-protocol/schema/typescript/v2/ToolRequestUserInputParams";
import type { ToolRequestUserInputQuestion } from "../../../codex-rs/app-server-protocol/schema/typescript/v2/ToolRequestUserInputQuestion";
import type { ToolRequestUserInputResponse } from "../../../codex-rs/app-server-protocol/schema/typescript/v2/ToolRequestUserInputResponse";
import type { UserInput } from "../../../codex-rs/app-server-protocol/schema/typescript/v2/UserInput";
import type { WebSearchAction } from "../../../codex-rs/app-server-protocol/schema/typescript/v2/WebSearchAction";

export type {
  AgentContactsConfig,
  AgentInfo,
  AgentListResponse,
  AgentReadResponse,
  AgentUpdateParams,
  AgentUpdateResponse,
  AgentMessageDeltaNotification,
  ClientInfo,
  CommandExecutionApprovalDecision,
  CommandExecutionRequestApprovalParams,
  CommandExecutionRequestApprovalResponse,
  CommandExecutionOutputDeltaNotification,
  Config,
  ConfigProviderInfo,
  ConfigProvidersResponse,
  ConfigReadParams,
  ConfigReadResponse,
  ContactCreateParams,
  ContactDeleteParams,
  ContactListResponse,
  DynamicToolCallOutputContentItem,
  DynamicToolCallParams,
  DynamicToolCallResponse,
  ErrorNotification,
  FileChangeApprovalDecision,
  FileChangeRequestApprovalParams,
  FileChangeRequestApprovalResponse,
  FileChangeOutputDeltaNotification,
  GrantedPermissionProfile,
  InitializeCapabilities,
  InitializeResponse,
  ItemCompletedNotification,
  ItemStartedNotification,
  McpElicitationSchema,
  McpServerElicitationAction,
  McpServerElicitationRequestParams,
  McpServerElicitationRequestResponse,
  Model,
  ModelListResponse,
  PermissionGrantScope,
  PermissionsRequestApprovalParams,
  PermissionsRequestApprovalResponse,
  PlanDeltaNotification,
  ReasoningSummaryPartAddedNotification,
  ReasoningSummaryTextDeltaNotification,
  ReasoningTextDeltaNotification,
  RequestPermissionProfile,
  SkillMetadata,
  SkillsListParams,
  SkillsListResponse,
  TerminalInteractionNotification,
  Thread,
  ThreadItem,
  ThreadListParams,
  ThreadListResponse,
  ThreadPendingInputDeleteParams,
  ThreadPendingInputDeleteResponse,
  ThreadPendingInputItem,
  ThreadPendingInputReadParams,
  ThreadPendingInputReadResponse,
  ThreadPendingInputUpdatedNotification,
  ThreadReadParams,
  ThreadReadResponse,
  ThreadResumeParams,
  ThreadResumeResponse,
  ThreadStartParams,
  ThreadStartResponse,
  ThreadTokenUsage,
  ThreadTokenUsageUpdatedNotification,
  ThreadTurnQueueItem,
  ThreadTurnQueueReadResponse,
  ThreadTurnQueueDeleteResponse,
  ThreadTurnQueueUpdateResponse,
  ThreadTurnQueueUpdatedNotification,
  Turn,
  TurnAbortedNotification,
  TurnCompletedNotification,
  TurnDiffUpdatedNotification,
  TurnPlanUpdatedNotification,
  TurnStartedNotification,
  TurnStartParams,
  TurnStartResponse,
  ToolRequestUserInputAnswer,
  ToolRequestUserInputOption,
  ToolRequestUserInputParams,
  ToolRequestUserInputQuestion,
  ToolRequestUserInputResponse,
  UserInput,
  WebSearchAction,
};

export type CodexNotification =
  | { method: "thread/started"; params: { thread: Thread } }
  | {
      method: "thread/pendingInput/updated";
      params: ThreadPendingInputUpdatedNotification;
    }
  | {
      method: "thread/turnQueue/updated";
      params: ThreadTurnQueueUpdatedNotification;
    }
  | { method: "turn/started"; params: TurnStartedNotification }
  | { method: "turn/aborted"; params: TurnAbortedNotification }
  | { method: "item/started"; params: ItemStartedNotification }
  | { method: "item/completed"; params: ItemCompletedNotification }
  | { method: "item/agentMessage/delta"; params: AgentMessageDeltaNotification }
  | { method: "item/plan/delta"; params: PlanDeltaNotification }
  | {
      method: "item/reasoning/summaryTextDelta";
      params: ReasoningSummaryTextDeltaNotification;
    }
  | {
      method: "item/reasoning/summaryPartAdded";
      params: ReasoningSummaryPartAddedNotification;
    }
  | {
      method: "item/reasoning/textDelta";
      params: ReasoningTextDeltaNotification;
    }
  | {
      method: "item/commandExecution/outputDelta";
      params: CommandExecutionOutputDeltaNotification;
    }
  | {
      method: "item/commandExecution/terminalInteraction";
      params: TerminalInteractionNotification;
    }
  | {
      method: "item/fileChange/outputDelta";
      params: FileChangeOutputDeltaNotification;
    }
  | { method: "turn/plan/updated"; params: TurnPlanUpdatedNotification }
  | { method: "turn/diff/updated"; params: TurnDiffUpdatedNotification }
  | {
      method: "thread/tokenUsage/updated";
      params: ThreadTokenUsageUpdatedNotification;
    }
  | { method: "error"; params: ErrorNotification }
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
