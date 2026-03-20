import type { CodexTransport } from "./transport";
import type {
  AgentInfo,
  AgentListResponse,
  AgentReadResponse,
  AgentUpdateParams,
  AgentUpdateResponse,
  ApprovalPolicy,
  CodexNotification,
  InitializeResponse,
  Model,
  ModelListResponse,
  PersonalityMode,
  SandboxMode,
  SkillMetadata,
  SkillsListResponse,
  Thread,
  ThreadListResponse,
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
  personality: PersonalityMode;
  approvalPolicy: ApprovalPolicy;
  sandboxMode: SandboxMode;
};

export class CodexAppServerClient {
  constructor(private readonly transport: CodexTransport) {}

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
        case "turn/started":
        case "item/started":
        case "item/completed":
        case "item/agentMessage/delta":
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
          experimentalApi: false,
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

  async listAgentThreads(): Promise<Thread[]> {
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
        sourceKinds: [
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

  async readThread(threadId: string): Promise<Thread> {
    const response = await this.transport.request<ThreadReadResponse>(
      "thread/read",
      {
        threadId,
        includeTurns: true,
      },
    );
    return response.thread;
  }

  async resumeThread(
    threadId: string,
    settings: ThreadRuntimeSettings,
  ): Promise<Thread> {
    const response = await this.transport.request<ThreadResumeResponse>(
      "thread/resume",
      {
        threadId,
        cwd: settings.cwd || null,
        model: settings.model,
        personality: normalizePersonality(settings.personality),
        approvalPolicy: normalizeApprovalPolicy(settings.approvalPolicy),
        sandbox: normalizeSandboxMode(settings.sandboxMode),
        persistExtendedHistory: true,
      },
    );
    return response.thread;
  }

  async startThread(settings: ThreadRuntimeSettings): Promise<Thread> {
    const response = await this.transport.request<ThreadStartResponse>(
      "thread/start",
      {
        cwd: settings.cwd || null,
        model: settings.model,
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
