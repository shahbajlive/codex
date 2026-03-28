import type { CodexTransport, RpcRequest } from "./transport";
import type {
  AgentInfo,
  AgentListResponse,
  AgentReadResponse,
  AgentUpdateParams,
  AgentUpdateResponse,
  ApprovalPolicy,
  CodexNotification,
  ConfigReadResponse,
  ConfigProvidersResponse,
  ContactCreateParams,
  ContactDeleteParams,
  ContactListResponse,
  InitializeResponse,
  Model,
  ModelListResponse,
  PersonalityMode,
  SandboxMode,
  SkillMetadata,
  SkillsListResponse,
  Thread,
  ThreadListResponse,
  ThreadPendingInputDeleteResponse,
  ThreadPendingInputReadResponse,
  ThreadReadResponse,
  ThreadResumeResponse,
  ThreadStartResponse,
  Turn,
  TurnStartResponse,
  UserInput,
} from "./protocol";

export type ThreadRuntimeSettings = {
  cwd: string;
  model: string | null;
  modelProvider: string | null;
  personality: PersonalityMode;
  approvalPolicy: ApprovalPolicy;
  sandboxMode: SandboxMode;
};

export class CodexAppServerClient {
  private readonly serverRequestHandlers = new Map<
    string,
    (params: unknown) => Promise<unknown> | unknown
  >();

  constructor(private readonly transport: CodexTransport) {
    this.transport.onRequest((request) => this.handleServerRequest(request));
  }

  async connect() {
    await this.transport.connect();
  }

  disconnect() {
    this.transport.disconnect();
  }

  onNotification(listener: (notification: CodexNotification) => void) {
    return this.transport.onNotification((notification) => {
      switch (notification.method) {
        case "thread/started":
        case "thread/pendingInput/updated":
        case "thread/turnQueue/updated":
        case "turn/started":
        case "turn/aborted":
        case "item/started":
        case "item/completed":
        case "item/agentMessage/delta":
        case "item/plan/delta":
        case "item/reasoning/summaryTextDelta":
        case "item/reasoning/textDelta":
        case "item/reasoning/summaryPartAdded":
        case "item/commandExecution/outputDelta":
        case "item/commandExecution/terminalInteraction":
        case "item/fileChange/outputDelta":
        case "turn/plan/updated":
        case "turn/diff/updated":
        case "thread/tokenUsage/updated":
        case "error":
        case "turn/completed":
          listener(notification as CodexNotification);
          break;
        default:
          break;
      }
    });
  }

  onStatusChange(
    listener: (
      status: "idle" | "connecting" | "connected" | "disconnected",
    ) => void,
  ) {
    return this.transport.onStatusChange(listener);
  }

  onServerRequest(
    method: string,
    handler: (params: unknown) => Promise<unknown> | unknown,
  ) {
    this.serverRequestHandlers.set(method, handler);
    return () => {
      const current = this.serverRequestHandlers.get(method);
      if (current === handler) {
        this.serverRequestHandlers.delete(method);
      }
    };
  }

  async initialize(): Promise<InitializeResponse> {
    const response = await this.transport.request<InitializeResponse>(
      "initialize",
      {
        clientInfo: {
          name: "codex_web_ui",
          title: "Codex Web UI",
          version: "0.1.0",
        },
        capabilities: {
          experimentalApi: true,
          optOutNotificationMethods: null,
        },
      },
    );
    this.transport.notify("initialized");
    return response;
  }

  async listThreads(): Promise<Thread[]> {
    const response = await this.transport.request<ThreadListResponse>(
      "thread/list",
      {
        archived: false,
        cursor: null,
        cwd: null,
        limit: 100,
        modelProviders: null,
        searchTerm: null,
        sortKey: "updated_at",
        sourceKinds: null,
      },
    );
    return response.data;
  }

  async readConfig(cwd?: string): Promise<ConfigReadResponse> {
    return this.transport.request<ConfigReadResponse>("config/read", {
      includeLayers: false,
      cwd: cwd || null,
    });
  }

  async listConfigProviders(): Promise<ConfigProvidersResponse["providers"]> {
    const response = await this.transport.request<ConfigProvidersResponse>(
      "config/providers",
      null,
    );
    return response.providers;
  }

  async listAgentThreads(agentId?: string): Promise<Thread[]> {
    const response = await this.transport.request<ThreadListResponse>(
      "thread/list",
      {
        agentId: agentId || null,
        archived: false,
        cursor: null,
        cwd: null,
        limit: 100,
        modelProviders: null,
        searchTerm: null,
        sortKey: "updated_at",
        sourceKinds: agentId
          ? null
          : [
              "subAgent",
              "subAgentReview",
              "subAgentCompact",
              "subAgentThreadSpawn",
              "subAgentOther",
            ],
      },
    );
    return response.data;
  }

  async listAgents(cwd?: string): Promise<AgentInfo[]> {
    const response = await this.transport.request<AgentListResponse>(
      "agent/listIsolated",
      { agentDir: cwd || null },
    );
    return response.agents;
  }

  async readAgent(id: string, cwd?: string): Promise<AgentReadResponse> {
    return this.transport.request<AgentReadResponse>("agent/readIsolated", {
      id,
      agentDir: cwd || null,
    });
  }

  async updateAgent(params: AgentUpdateParams): Promise<AgentUpdateResponse> {
    return this.transport.request<AgentUpdateResponse>(
      "agent/updateIsolated",
      params,
    );
  }

  async getAgentWorkspaceFiles(
    id: string,
    agentDir?: string,
  ): Promise<{ files: { filename: string; content: string }[] }> {
    return this.transport.request("agent/workspaceFiles", {
      id,
      agentDir: agentDir || null,
    });
  }

  async saveAgentWorkspaceFiles(
    id: string,
    files: { filename: string; content: string }[],
    agentDir?: string,
  ): Promise<void> {
    await this.transport.request("agent/workspaceFiles/update", {
      id,
      agentDir: agentDir || null,
      files,
    });
  }

  async readThread(threadId: string, includeTurns = true): Promise<Thread> {
    const response = await this.readThreadSnapshot(threadId, includeTurns);
    return response.thread;
  }

  async readThreadSnapshot(
    threadId: string,
    includeTurns = true,
  ): Promise<ThreadReadResponse> {
    return this.transport.request<ThreadReadResponse>("thread/read", {
      threadId,
      includeTurns,
    });
  }

  async readThreadPendingInput(
    threadId: string,
  ): Promise<ThreadPendingInputReadResponse> {
    return this.transport.request<ThreadPendingInputReadResponse>(
      "thread/pendingInput/read",
      { threadId },
    );
  }

  async deleteThreadPendingInput(
    threadId: string,
    index: number,
  ): Promise<ThreadPendingInputDeleteResponse> {
    return this.transport.request<ThreadPendingInputDeleteResponse>(
      "thread/pendingInput/delete",
      { threadId, index },
    );
  }

  async readThreadTurnQueue(
    threadId: string,
  ): Promise<ThreadTurnQueueReadResponse> {
    return this.transport.request<ThreadTurnQueueReadResponse>(
      "thread/turnQueue/read",
      { threadId },
    );
  }

  async deleteThreadTurnQueue(
    threadId: string,
    index: number,
  ): Promise<ThreadTurnQueueDeleteResponse> {
    return this.transport.request<ThreadTurnQueueDeleteResponse>(
      "thread/turnQueue/delete",
      { threadId, index },
    );
  }

  async updateThreadTurnQueue(
    threadId: string,
    index: number,
    text: string,
  ): Promise<ThreadTurnQueueUpdateResponse> {
    return this.transport.request<ThreadTurnQueueUpdateResponse>(
      "thread/turnQueue/update",
      { threadId, index, text },
    );
  }

  async resumeThread(
    threadId: string,
    settings: ThreadRuntimeSettings,
  ): Promise<Thread> {
    const response = await this.resumeThreadSnapshot(threadId, settings);
    return response.thread;
  }

  async resumeThreadSnapshot(
    threadId: string,
    settings: ThreadRuntimeSettings,
  ): Promise<ThreadResumeResponse> {
    return this.transport.request<ThreadResumeResponse>("thread/resume", {
      threadId,
      cwd: settings.cwd || null,
      model: settings.model,
      personality: normalizePersonality(settings.personality),
      approvalPolicy: normalizeApprovalPolicy(settings.approvalPolicy),
      sandbox: normalizeSandboxMode(settings.sandboxMode),
      persistExtendedHistory: true,
    });
  }

  async startThread(settings: ThreadRuntimeSettings): Promise<Thread> {
    const response = await this.transport.request<ThreadStartResponse>(
      "thread/start",
      {
        cwd: settings.cwd || null,
        model: settings.model,
        modelProvider: settings.modelProvider,
        personality: normalizePersonality(settings.personality),
        approvalPolicy: normalizeApprovalPolicy(settings.approvalPolicy),
        sandbox: normalizeSandboxMode(settings.sandboxMode),
        experimentalRawEvents: false,
        persistExtendedHistory: true,
      },
    );
    return response.thread;
  }

  async startTurn(
    threadId: string,
    text: string,
    settings: ThreadRuntimeSettings,
  ): Promise<Turn> {
    const input: UserInput[] = [
      {
        type: "text",
        text,
        text_elements: [],
      },
    ];

    const response = await this.transport.request<TurnStartResponse>(
      "turn/start",
      {
        threadId,
        input,
        cwd: settings.cwd || null,
        model: settings.model,
        personality: normalizePersonality(settings.personality),
        approvalPolicy: normalizeApprovalPolicy(settings.approvalPolicy),
        sandboxPolicy: buildSandboxPolicy(settings),
      },
    );
    return response.turn;
  }

  async interruptTurn(threadId: string, turnId: string): Promise<void> {
    await this.transport.request("turn/interrupt", {
      threadId,
      turnId,
    });
  }

  async listModels(): Promise<Model[]> {
    const response = await this.transport.request<ModelListResponse>(
      "model/list",
      {
        cursor: null,
        includeHidden: false,
        limit: 100,
      },
    );
    return response.data;
  }

  async listSkills(cwd?: string): Promise<SkillMetadata[]> {
    const response = await this.transport.request<SkillsListResponse>(
      "skills/list",
      {
        cwd: cwd || null,
        bypassCache: false,
      },
    );
    return response.data.flatMap((entry) => entry.skills);
  }

  async forkThread(
    threadId: string,
    settings: ThreadRuntimeSettings,
  ): Promise<Thread> {
    const response = await this.transport.request<{ thread: Thread }>(
      "thread/fork",
      {
        threadId,
        cwd: settings.cwd || null,
        model: settings.model,
        approvalPolicy: normalizeApprovalPolicy(settings.approvalPolicy),
        sandbox: normalizeSandboxMode(settings.sandboxMode),
        persistExtendedHistory: true,
      },
    );
    return response.thread;
  }

  async setThreadName(threadId: string, name: string): Promise<void> {
    await this.transport.request("thread/name/set", {
      threadId,
      name,
    });
  }

  async compactThread(threadId: string): Promise<void> {
    await this.transport.request("thread/compact/start", {
      threadId,
    });
  }

  async runThreadShellCommand(
    threadId: string,
    command: string,
  ): Promise<void> {
    await this.transport.request("thread/shellCommand", {
      threadId,
      command,
    });
  }

  async cleanBackgroundTerminals(threadId: string): Promise<void> {
    await this.transport.request("thread/backgroundTerminals/clean", {
      threadId,
    });
  }

  async startReview(
    threadId: string,
    target:
      | { type: "uncommittedChanges" }
      | { type: "custom"; instructions: string },
  ): Promise<{ turn: Turn; reviewThreadId: string }> {
    return this.transport.request("review/start", {
      threadId,
      target,
      delivery: "inline",
    });
  }

  async listExperimentalFeatures(): Promise<
    Array<{
      name: string;
      stage: string;
      enabled: boolean;
      displayName: string | null;
      description: string | null;
    }>
  > {
    const response = await this.transport.request<{
      data: Array<{
        name: string;
        stage: string;
        enabled: boolean;
        displayName: string | null;
        description: string | null;
      }>;
    }>("experimentalFeature/list", {});
    return response.data;
  }

  async listApps(
    threadId?: string,
  ): Promise<Array<{ name: string; isEnabled: boolean }>> {
    const response = await this.transport.request<{
      data: Array<{ name: string; isEnabled: boolean }>;
    }>("app/list", {
      cursor: null,
      limit: 100,
      threadId: threadId || null,
      forceRefetch: false,
    });
    return response.data;
  }

  async listPlugins(
    cwd?: string,
  ): Promise<Array<{ name: string; installed: boolean; enabled: boolean }>> {
    const response = await this.transport.request<{
      marketplaces: Array<{
        plugins: Array<{ name: string; installed: boolean; enabled: boolean }>;
      }>;
    }>("plugin/list", {
      cwds: cwd ? [cwd] : null,
      forceRemoteSync: false,
    });
    return response.marketplaces.flatMap((marketplace) => marketplace.plugins);
  }

  async listMcpServers(): Promise<Array<{ name: string; authStatus: string }>> {
    const response = await this.transport.request<{
      data: Array<{ name: string; authStatus: string }>;
    }>("mcpServerStatus/list", {
      cursor: null,
      limit: 100,
    });
    return response.data;
  }

  async logout(): Promise<void> {
    await this.transport.request("account/logout", null);
  }

  async uploadFeedback(
    reason: string | null,
    threadId?: string,
  ): Promise<void> {
    await this.transport.request("feedback/upload", {
      classification: "general",
      reason,
      threadId: threadId || null,
      includeLogs: false,
      extraLogFiles: null,
    });
  }

  async writeFile(path: string, dataBase64: string): Promise<void> {
    await this.transport.request("fs/writeFile", {
      path,
      dataBase64,
    });
  }

  async createDirectory(path: string, recursive?: boolean): Promise<void> {
    await this.transport.request("fs/createDirectory", {
      path,
      recursive: recursive ?? true,
    });
  }

  async listContacts(): Promise<ContactListResponse["data"]> {
    const response = await this.transport.request<ContactListResponse>(
      "contact/list",
      null,
    );
    return response.data;
  }

  async createContact(id: string, publicThreadId: string): Promise<void> {
    const params: ContactCreateParams = { id, publicThreadId };
    await this.transport.request("contact/create", params);
  }

  async deleteContact(id: string): Promise<void> {
    const params: ContactDeleteParams = { id };
    await this.transport.request("contact/delete", params);
  }

  async startThreadForAgent(
    agentId: string,
    overrides?: {
      approvalPolicy?: ApprovalPolicy | null;
      sandboxMode?: SandboxMode | null;
    },
  ): Promise<Thread> {
    const response = await this.transport.request<ThreadStartResponse>(
      "thread/start",
      {
        agentId,
        approvalPolicy: overrides?.approvalPolicy ?? null,
        sandbox: overrides?.sandboxMode
          ? normalizeSandboxMode(overrides.sandboxMode)
          : null,
        persistExtendedHistory: true,
      },
    );
    return response.thread;
  }

  private async handleServerRequest(request: RpcRequest) {
    const handler = this.serverRequestHandlers.get(request.method);
    if (!handler) {
      throw new Error(`Unhandled server request: ${request.method}`);
    }
    return handler(request.params);
  }
}

function normalizePersonality(value: PersonalityMode): string | null {
  if (value === "none") {
    return "none";
  }
  return value;
}

function normalizeApprovalPolicy(value: ApprovalPolicy): string {
  switch (value) {
    case "on-failure":
      return "on-failure";
    case "on-request":
      return "on-request";
    case "never":
      return "never";
    case "untrusted":
    default:
      return "untrusted";
  }
}

function normalizeSandboxMode(value: SandboxMode): string {
  switch (value) {
    case "read-only":
      return "read-only";
    case "danger-full-access":
      return "danger-full-access";
    case "workspace-write":
    default:
      return "workspace-write";
  }
}

function buildSandboxPolicy(settings: ThreadRuntimeSettings) {
  switch (settings.sandboxMode) {
    case "danger-full-access":
      return {
        type: "dangerFullAccess" as const,
      };
    case "read-only":
      return {
        type: "readOnly" as const,
        access: {
          type: "fullAccess" as const,
        },
        networkAccess: false,
      };
    case "workspace-write":
    default:
      return {
        type: "workspaceWrite" as const,
        writableRoots: settings.cwd ? [settings.cwd] : [],
        readOnlyAccess: {
          type: "fullAccess" as const,
        },
        networkAccess: false,
        excludeTmpdirEnvVar: false,
        excludeSlashTmp: false,
      };
  }
}
