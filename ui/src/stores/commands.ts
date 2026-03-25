import { defineStore } from "pinia";
import type {
  CommandExecutionRequestApprovalParams,
  CommandExecutionRequestApprovalResponse,
  DynamicToolCallParams,
  FileChangeRequestApprovalParams,
  FileChangeRequestApprovalResponse,
  GrantedPermissionProfile,
  McpServerElicitationRequestParams,
  PermissionsRequestApprovalParams,
  PermissionsRequestApprovalResponse,
  Thread,
  ThreadTokenUsage,
  ToolRequestUserInputQuestion,
  ToolRequestUserInputParams,
} from "../lib/protocol";
import {
  attachTurn,
  buildLiveTranscriptTurn,
  buildTranscript,
  type TranscriptTurn,
} from "../lib/transcript";
import { slashCommands } from "../lib/slash-commands";
import { clientRef, useAgentsStore } from "./agents";
import { useChatStore } from "./chat";
import { useSettingsStore } from "./settings";

const knownSlashCommands = new Set([
  ...slashCommands.map((entry) => entry.command),
  "/clean",
]);

type WorkspaceCommandContext = {
  agentThreads: Thread[];
  selectedThreadId: string | null;
  attachedThreadId: string | null;
  selectedModelProvider: string | null;
  selectedTokenUsage: ThreadTokenUsage | null;
  contextWindow: number | null;
  modelLabel: string;
  transcript: TranscriptTurn[];
  activeTurnId: string | null;
  liveTranscriptTurn: ReturnType<typeof buildLiveTranscriptTurn> | null;
  replaceThread(thread: Thread): void;
  startFreshThreadForSelectedAgent(): Promise<string | null>;
  addLocalEvent(
    label: string,
    detail: string,
    tone?: "info" | "warning" | "error",
  ): void;
  setTranscript(turns: TranscriptTurn[]): void;
  refreshRuntimeMetadata(): Promise<void>;
};

type WorkspaceRequestContext = {
  pendingRequest: WorkspacePendingRequest | null;
  selectThreadForRequest(threadId: string): Promise<void>;
};

export type WorkspaceApprovalRequest =
  | {
      kind: "command";
      title: string;
      threadId: string;
      turnId: string;
      itemId: string;
      reason: string | null;
      command: string | null;
      cwd: string | null;
      choices: Array<{
        label: string;
        value: CommandExecutionRequestApprovalResponse["decision"];
      }>;
    }
  | {
      kind: "file-change";
      title: string;
      threadId: string;
      turnId: string;
      itemId: string;
      reason: string | null;
      grantRoot: string | null;
      choices: Array<{
        label: string;
        value: FileChangeRequestApprovalResponse["decision"];
      }>;
    }
  | {
      kind: "permissions";
      title: string;
      threadId: string;
      turnId: string;
      itemId: string;
      reason: string | null;
      permissionSummary: string[];
      choices: Array<{
        label: string;
        value: PermissionsRequestApprovalResponse;
      }>;
    };

export type WorkspacePromptRequest = {
  kind: "prompt";
  title: string;
  threadId: string;
  turnId: string;
  itemId: string;
  questions: ToolRequestUserInputQuestion[];
};

export type WorkspaceElicitationRequest =
  | {
      kind: "mcp-url";
      title: string;
      threadId: string;
      turnId: string | null;
      serverName: string;
      message: string;
      url: string;
      elicitationId: string;
    }
  | {
      kind: "mcp-form";
      title: string;
      threadId: string;
      turnId: string | null;
      serverName: string;
      message: string;
      fields: Array<{
        key: string;
        label: string;
        description: string | null;
        type: "text" | "number" | "boolean";
        required: boolean;
        defaultValue: string | number | boolean | null;
      }>;
    };

export type WorkspaceDynamicToolRequest = {
  kind: "dynamic-tool";
  title: string;
  threadId: string;
  turnId: string;
  callId: string;
  tool: string;
  argumentsJson: string;
};

export type WorkspacePendingRequest =
  | WorkspaceApprovalRequest
  | WorkspacePromptRequest
  | WorkspaceElicitationRequest
  | WorkspaceDynamicToolRequest;

let resolvePendingRequest: ((value: unknown) => void) | null = null;
let rejectPendingRequest: ((reason?: unknown) => void) | null = null;

export const useCommandsStore = defineStore("commands", {
  actions: {
    registerWorkspaceRequestHandlers(store: WorkspaceRequestContext) {
      const client = clientRef.client;
      if (!client) {
        return;
      }

      client.onServerRequest(
        "item/commandExecution/requestApproval",
        async (params: unknown) =>
          this.waitForPendingRequest(
            store,
            buildCommandApprovalRequest(
              params as CommandExecutionRequestApprovalParams,
            ),
          ),
      );
      client.onServerRequest(
        "item/fileChange/requestApproval",
        async (params: unknown) =>
          this.waitForPendingRequest(
            store,
            buildFileChangeApprovalRequest(
              params as FileChangeRequestApprovalParams,
            ),
          ),
      );
      client.onServerRequest(
        "item/permissions/requestApproval",
        async (params: unknown) =>
          this.waitForPendingRequest(
            store,
            buildPermissionsApprovalRequest(
              params as PermissionsRequestApprovalParams,
            ),
          ),
      );
      client.onServerRequest(
        "item/tool/requestUserInput",
        async (params: unknown) =>
          this.waitForPendingRequest(
            store,
            buildPromptRequest(params as ToolRequestUserInputParams),
          ),
      );
      client.onServerRequest(
        "mcpServer/elicitation/request",
        async (params: unknown) =>
          this.waitForPendingRequest(
            store,
            buildWorkspaceElicitationRequest(
              params as McpServerElicitationRequestParams,
            ),
          ),
      );
      client.onServerRequest("item/tool/call", async (params: unknown) =>
        this.waitForPendingRequest(
          store,
          buildWorkspaceDynamicToolRequest(params as DynamicToolCallParams),
        ),
      );
    },

    async waitForPendingRequest(
      store: WorkspaceRequestContext,
      request: WorkspacePendingRequest,
    ) {
      await store.selectThreadForRequest(request.threadId);
      store.pendingRequest = request;
      return new Promise((resolve, reject) => {
        rejectPendingRequest?.(new Error("Superseded by newer request"));
        resolvePendingRequest = resolve;
        rejectPendingRequest = reject;
      });
    },

    resolvePendingRequest(store: WorkspaceRequestContext, response: unknown) {
      resolvePendingRequest?.(response);
      store.pendingRequest = null;
      resolvePendingRequest = null;
      rejectPendingRequest = null;
    },

    rejectPendingRequest(
      store: WorkspaceRequestContext,
      message = "Request cancelled",
    ) {
      rejectPendingRequest?.(new Error(message));
      store.pendingRequest = null;
      resolvePendingRequest = null;
      rejectPendingRequest = null;
    },

    async handleWorkspaceSlashCommand(
      store: WorkspaceCommandContext,
      message: string,
    ): Promise<boolean> {
      if (!message.startsWith("/")) {
        return false;
      }

      const client = clientRef.client;
      if (!client) {
        return true;
      }

      const parsed = this.parseSlashCommand(message);
      if (!parsed) {
        return false;
      }

      const { command, args } = parsed;
      const chatStore = useChatStore();

      switch (command) {
        case "/new":
        case "/clear": {
          store.attachedThreadId = null;
          store.selectedTokenUsage = null;
          store.activeTurnId = null;
          store.liveTranscriptTurn = null;
          store.setTranscript(buildTranscript(null));
          await store.startFreshThreadForSelectedAgent();
          store.addLocalEvent(
            command === "/new" ? "Started new chat" : "Cleared chat",
            `Active agent: ${useAgentsStore().selectedAgent?.name || "unknown"}`,
          );
          return true;
        }
        case "/clean":
        case "/stop": {
          if (!store.selectedThreadId) {
            store.addLocalEvent(
              "No active thread",
              `${command} needs an active thread.`,
              "warning",
            );
            return true;
          }
          if (command === "/clean") {
            await client.cleanBackgroundTerminals(store.selectedThreadId);
            store.addLocalEvent(
              "Stopped background terminals",
              `Requested cleanup for ${store.selectedThreadId}.`,
            );
          } else {
            store.addLocalEvent(
              "Background terminals",
              "Use /clean to stop background terminals in the web UI.",
            );
          }
          return true;
        }
        case "/agent":
        case "/subagents": {
          if (!args) {
            store.addLocalEvent(
              "Switch agent",
              `Use the sidebar to switch agent threads. Current agent: ${chatStore.getSelectedAgentName()}`,
            );
            return true;
          }
          const matches = chatStore.findAgents(args);
          if (matches.length === 1) {
            const [agent] = matches;
            await useAgentsStore().selectAgent(agent.id);
            store.addLocalEvent(
              "Switched agent",
              `Now chatting with ${agent.name}.`,
            );
            return true;
          }
          if (matches.length === 0) {
            store.addLocalEvent(
              "Unknown agent",
              `No agent matches "${args}".`,
              "warning",
            );
            return true;
          }
          store.addLocalEvent(
            "Multiple agent matches",
            matches.map((agent) => agent.name).join(", "),
            "warning",
          );
          return true;
        }
        case "/review": {
          const threadId = store.selectedThreadId;
          if (!threadId) {
            store.addLocalEvent(
              "Review unavailable",
              "Start or resume a chat before running /review.",
              "warning",
            );
            return true;
          }
          const review = await client.startReview(
            threadId,
            args
              ? { type: "custom", instructions: args }
              : { type: "uncommittedChanges" },
          );
          const currentThread = chatStore.getSelectedThread(store);
          if (currentThread && review.reviewThreadId === currentThread.id) {
            const updated = attachTurn(currentThread, review.turn) as Thread;
            store.replaceThread(updated);
            store.liveTranscriptTurn = buildLiveTranscriptTurn(
              updated,
              store.activeTurnId,
            );
            store.setTranscript(buildTranscript(updated));
          }
          store.addLocalEvent(
            "Review started",
            args || "Started review for uncommitted changes.",
          );
          return true;
        }
        case "/rename": {
          if (!store.selectedThreadId) {
            store.addLocalEvent(
              "Rename unavailable",
              "Start or resume a chat before renaming it.",
              "warning",
            );
            return true;
          }
          if (!args) {
            store.addLocalEvent(
              "Rename chat",
              "Usage: /rename <new thread name>",
              "warning",
            );
            return true;
          }
          await client.setThreadName(store.selectedThreadId, args);
          const currentThread = chatStore.getSelectedThread(store);
          if (currentThread) {
            store.replaceThread({ ...currentThread, name: args } as Thread);
          }
          store.addLocalEvent("Renamed chat", args);
          return true;
        }
        case "/resume": {
          const threads = await client.listThreads();
          if (!args) {
            const recent = threads
              .slice(0, 5)
              .map((thread) => thread.name || thread.preview || thread.id);
            store.addLocalEvent(
              "Resume chat",
              recent.length > 0
                ? `Recent chats: ${recent.join(" | ")}`
                : "No saved chats available.",
            );
            return true;
          }
          const matches = this.findMatchingThreads(threads, args);
          if (matches.length !== 1) {
            store.addLocalEvent(
              matches.length === 0 ? "Unknown chat" : "Multiple chat matches",
              matches.length === 0
                ? `No chat matches "${args}".`
                : matches
                    .map((thread) => thread.name || thread.preview || thread.id)
                    .join(", "),
              "warning",
            );
            return true;
          }
          const [thread] = matches;
          const resumedThread = (await client.resumeThread(
            thread.id,
            chatStore.runtimeSettings(),
          )) as Thread;
          store.selectedThreadId = thread.id;
          store.replaceThread(resumedThread);
          store.attachedThreadId = thread.id;
          store.selectedModelProvider = resumedThread.modelProvider ?? null;
          store.selectedTokenUsage = null;
          store.activeTurnId = chatStore.findActiveTurnId(resumedThread);
          store.liveTranscriptTurn = buildLiveTranscriptTurn(
            resumedThread,
            store.activeTurnId,
          );
          store.setTranscript(buildTranscript(resumedThread));
          store.addLocalEvent(
            "Resumed chat",
            resumedThread.name || resumedThread.preview || thread.id,
          );
          return true;
        }
        case "/status": {
          store.addLocalEvent(
            "Workspace status",
            [
              `Agent: ${chatStore.getSelectedAgentName()}`,
              `Thread: ${store.selectedThreadId || "none"}`,
              `Model: ${store.modelLabel || "default"}`,
              `Provider: ${store.selectedModelProvider || "unknown"}`,
              `Context: ${store.contextWindow ?? "unknown"}`,
              `Tokens: ${store.selectedTokenUsage?.total.totalTokens ?? 0}`,
            ].join("\n"),
          );
          return true;
        }
        case "/debug-config": {
          const response = await client.readConfig(
            chatStore.runtimeSettings().cwd || undefined,
          );
          store.addLocalEvent(
            "Debug config",
            JSON.stringify(response.config, null, 2),
          );
          return true;
        }
        case "/model": {
          const agentsStore = useAgentsStore();
          if (!args) {
            const models = await client.listModels();
            store.addLocalEvent(
              "Available models",
              models
                .slice(0, 8)
                .map((m) => m.id)
                .join(", ") || "No models returned by the server.",
            );
            return true;
          }
          const models = await client.listModels();
          const model = models.find((m) => m.id === args);
          if (!model) {
            const providers = Array.from(
              new Set(
                models
                  .map((entry) => {
                    const separator = entry.id.indexOf("/");
                    return separator > 0 ? entry.id.slice(0, separator) : null;
                  })
                  .filter((entry): entry is string => Boolean(entry)),
              ),
            );
            if (providers.includes(args)) {
              store.addLocalEvent(
                "Choose model",
                `Provider "${args}" selected. Continue with /model ${args}/<model>.`,
              );
              return true;
            }
            store.addLocalEvent(
              "Unknown model",
              `No model matches "${args}".`,
              "warning",
            );
            return true;
          }
          if (agentsStore.config) {
            agentsStore.config.model = model.id;
            const separator = model.id.indexOf("/");
            agentsStore.config.modelProvider =
              separator > 0 ? model.id.slice(0, separator) : "";
            await agentsStore.save();
          }
          store.modelLabel = model.id;
          await store.refreshRuntimeMetadata();
          store.addLocalEvent("Model updated", `Now using ${model.id}.`);
          return true;
        }
        case "/personality": {
          const settings = useSettingsStore();
          if (!args) {
            store.addLocalEvent(
              "Personality",
              `Current: ${settings.personality}. Options: friendly, pragmatic, none.`,
            );
            return true;
          }
          if (!["friendly", "pragmatic", "none"].includes(args)) {
            store.addLocalEvent(
              "Unknown personality",
              `Unsupported personality "${args}". Use friendly, pragmatic, or none.`,
              "warning",
            );
            return true;
          }
          settings.updateSettings({
            ...settings.$state,
            personality: args as "friendly" | "pragmatic" | "none",
          });
          store.addLocalEvent("Personality updated", args);
          return true;
        }
        case "/approvals":
        case "/permissions": {
          const agentConfig = useAgentsStore().config;
          store.addLocalEvent(
            "Permissions",
            `Approval policy: ${agentConfig?.approvalPolicy || "inherit"}\nSandbox: ${agentConfig?.sandboxMode || "inherit"}`,
          );
          return true;
        }
        case "/experimental": {
          const features = await client.listExperimentalFeatures();
          store.addLocalEvent(
            "Experimental features",
            features.length > 0
              ? features
                  .slice(0, 10)
                  .map(
                    (f) =>
                      `${f.enabled ? "[on]" : "[off]"} ${f.name} (${f.stage})`,
                  )
                  .join("\n")
              : "No experimental features returned by the server.",
          );
          return true;
        }
        case "/skills": {
          const skills = await client.listSkills(
            chatStore.runtimeSettings().cwd || undefined,
          );
          store.addLocalEvent(
            "Skills",
            skills.length > 0
              ? skills
                  .slice(0, 10)
                  .map((s) => s.name)
                  .join("\n")
              : "No skills available.",
          );
          return true;
        }
        case "/fork": {
          if (!store.selectedThreadId) {
            store.addLocalEvent(
              "Fork unavailable",
              "Start or resume a chat before forking it.",
              "warning",
            );
            return true;
          }
          const forkedThread = (await client.forkThread(
            store.selectedThreadId,
            chatStore.runtimeSettings(),
          )) as Thread;
          store.replaceThread(forkedThread);
          store.selectedThreadId = forkedThread.id;
          store.attachedThreadId = forkedThread.id;
          store.selectedModelProvider = forkedThread.modelProvider ?? null;
          store.selectedTokenUsage = null;
          store.activeTurnId = chatStore.findActiveTurnId(forkedThread);
          store.liveTranscriptTurn = buildLiveTranscriptTurn(
            forkedThread,
            store.activeTurnId,
          );
          store.setTranscript(buildTranscript(forkedThread));
          store.addLocalEvent(
            "Forked chat",
            forkedThread.name || forkedThread.id,
          );
          return true;
        }
        case "/compact": {
          if (!store.selectedThreadId) {
            store.addLocalEvent(
              "Compact unavailable",
              "Start or resume a chat before compacting it.",
              "warning",
            );
            return true;
          }
          await client.compactThread(store.selectedThreadId);
          store.addLocalEvent(
            "Compaction started",
            `Requested context compaction for ${store.selectedThreadId}.`,
          );
          return true;
        }
        case "/diff": {
          if (!store.selectedThreadId) {
            store.addLocalEvent(
              "Diff unavailable",
              "Start or resume a chat before running /diff.",
              "warning",
            );
            return true;
          }
          await client.runThreadShellCommand(
            store.selectedThreadId,
            "git diff --stat && git diff",
          );
          store.addLocalEvent(
            "Git diff",
            "Requested git diff in the active thread.",
          );
          return true;
        }
        case "/copy": {
          const text = chatStore.latestAssistantText(store.transcript);
          if (!text) {
            store.addLocalEvent(
              "Copy unavailable",
              "There is no assistant output to copy yet.",
              "warning",
            );
            return true;
          }
          if (typeof navigator !== "undefined" && navigator.clipboard) {
            await navigator.clipboard.writeText(text);
            store.addLocalEvent(
              "Copied output",
              "Latest assistant output copied to clipboard.",
            );
          } else {
            store.addLocalEvent(
              "Copy unavailable",
              "Clipboard access is not available in this browser context.",
              "warning",
            );
          }
          return true;
        }
        case "/theme": {
          const settings = useSettingsStore();
          if (!args) {
            store.addLocalEvent(
              "Theme",
              `Current theme: ${settings.theme}. Options: system, light, dark.`,
            );
            return true;
          }
          if (!["system", "light", "dark"].includes(args)) {
            store.addLocalEvent(
              "Unknown theme",
              `Unsupported theme "${args}". Use system, light, or dark.`,
              "warning",
            );
            return true;
          }
          settings.updateSettings({
            ...settings.$state,
            theme: args as "system" | "light" | "dark",
          });
          store.addLocalEvent("Theme updated", args);
          return true;
        }
        case "/mcp": {
          const servers = await client.listMcpServers();
          store.addLocalEvent(
            "MCP servers",
            servers.length > 0
              ? servers.map((s) => `${s.name}: ${s.authStatus}`).join("\n")
              : "No MCP servers available.",
          );
          return true;
        }
        case "/apps": {
          const apps = await client.listApps(
            store.selectedThreadId || undefined,
          );
          store.addLocalEvent(
            "Apps",
            apps.length > 0
              ? apps
                  .slice(0, 10)
                  .map((a) => `${a.isEnabled ? "[on]" : "[off]"} ${a.name}`)
                  .join("\n")
              : "No apps available.",
          );
          return true;
        }
        case "/plugins": {
          const plugins = await client.listPlugins(
            chatStore.runtimeSettings().cwd || undefined,
          );
          store.addLocalEvent(
            "Plugins",
            plugins.length > 0
              ? plugins
                  .slice(0, 10)
                  .map(
                    (p) =>
                      `${p.installed ? "[installed]" : "[available]"} ${p.name}${p.enabled ? " (enabled)" : ""}`,
                  )
                  .join("\n")
              : "No plugins available.",
          );
          return true;
        }
        case "/logout": {
          await client.logout();
          store.addLocalEvent("Logged out", "Requested account logout.");
          return true;
        }
        case "/feedback": {
          await client.uploadFeedback(
            args || null,
            store.selectedThreadId || undefined,
          );
          store.addLocalEvent(
            "Feedback sent",
            args || "Uploaded generic feedback without extra logs.",
          );
          return true;
        }
        case "/rollout": {
          store.addLocalEvent(
            "Rollout path",
            chatStore.getSelectedThread(store)?.path ||
              "This thread does not expose a rollout path yet.",
          );
          return true;
        }
        default: {
          const knownCommand = knownSlashCommands.has(command);
          const genericCopy: Record<string, string> = {
            "/setup-default-sandbox": `${command} is not configurable from the web UI yet.`,
            "/sandbox-add-read-dir": `${command} is not configurable from the web UI yet.`,
            "/plan": "Plan mode presets are not exposed in the web UI yet.",
            "/collab":
              "Collaboration mode presets are not exposed in the web UI yet.",
            "/mention": args
              ? `File mentions are not expanded automatically in the web UI yet: ${args}`
              : "Usage: /mention <path>",
            "/statusline":
              "Status line customization is not exposed in the web UI yet.",
            "/ps":
              "Background terminal listing is not exposed in the web UI yet.",
            "/fast": "Service-tier switching is not exposed in the web UI yet.",
            "/realtime":
              "Realtime voice mode is not exposed in the web UI yet.",
            "/settings":
              "Open the Settings page from the sidebar to adjust runtime and audio options.",
            "/init":
              "Run /init in the TUI for the guided flow, or create an `AGENTS.md` file manually.",
            "/quit":
              "Browser sessions cannot be terminated with slash commands. Close the tab instead.",
            "/exit":
              "Browser sessions cannot be terminated with slash commands. Close the tab instead.",
          };
          if (command in genericCopy) {
            store.addLocalEvent(
              command.replace(/^\//, "").replace(/-/g, " "),
              genericCopy[command]!,
              command === "/mention" && !args ? "warning" : "info",
            );
            return true;
          }
          store.addLocalEvent(
            knownCommand
              ? "Slash command not available yet"
              : "Unknown slash command",
            knownCommand
              ? `${command} is handled in the web UI, but this action is not wired up yet.`
              : `${command} is not a recognized Codex command.`,
            knownCommand ? "info" : "warning",
          );
          return true;
        }
      }
    },

    parseSlashCommand(message: string) {
      const trimmed = message.trim();
      if (!trimmed.startsWith("/")) return null;
      const [command, ...rest] = trimmed.split(/\s+/);
      return { command: command.toLowerCase(), args: rest.join(" ").trim() };
    },

    findMatchingThreads(threads: Thread[], query: string) {
      const normalized = query.trim().toLowerCase();
      return threads.filter((thread) => {
        const haystack =
          `${thread.id} ${thread.name || ""} ${thread.preview || ""}`.toLowerCase();
        return haystack.includes(normalized);
      });
    },
  },
});

function buildCommandApprovalRequest(
  params: CommandExecutionRequestApprovalParams,
): WorkspaceApprovalRequest {
  return {
    kind: "command",
    title: "Command approval required",
    threadId: params.threadId,
    turnId: params.turnId,
    itemId: params.itemId,
    reason: params.reason ?? null,
    command: params.command ?? null,
    cwd: params.cwd ?? null,
    choices: [
      { label: "Allow once", value: "accept" },
      { label: "Allow for session", value: "acceptForSession" },
      { label: "Decline", value: "decline" },
      { label: "Cancel", value: "cancel" },
    ],
  };
}

function buildFileChangeApprovalRequest(
  params: FileChangeRequestApprovalParams,
): WorkspaceApprovalRequest {
  return {
    kind: "file-change",
    title: "File change approval required",
    threadId: params.threadId,
    turnId: params.turnId,
    itemId: params.itemId,
    reason: params.reason ?? null,
    grantRoot: params.grantRoot ?? null,
    choices: [
      { label: "Allow once", value: "accept" },
      { label: "Allow for session", value: "acceptForSession" },
      { label: "Decline", value: "decline" },
      { label: "Cancel", value: "cancel" },
    ],
  };
}

function buildPermissionsApprovalRequest(
  params: PermissionsRequestApprovalParams,
): WorkspaceApprovalRequest {
  return {
    kind: "permissions",
    title: "Permissions requested",
    threadId: params.threadId,
    turnId: params.turnId,
    itemId: params.itemId,
    reason: params.reason,
    permissionSummary: summarizePermissions(params),
    choices: [
      {
        label: "Allow for this turn",
        value: { permissions: grantedPermissions(params), scope: "turn" },
      },
      {
        label: "Allow for session",
        value: { permissions: grantedPermissions(params), scope: "session" },
      },
      { label: "Decline", value: { permissions: {}, scope: "turn" } },
    ],
  };
}

function buildPromptRequest(
  params: ToolRequestUserInputParams,
): WorkspacePromptRequest {
  return {
    kind: "prompt",
    title: "Input requested",
    threadId: params.threadId,
    turnId: params.turnId,
    itemId: params.itemId,
    questions: params.questions ?? [],
  };
}

function buildWorkspaceElicitationRequest(
  params: McpServerElicitationRequestParams,
): WorkspaceElicitationRequest {
  if (params.mode === "url") {
    return {
      kind: "mcp-url",
      title: "MCP authentication required",
      threadId: params.threadId,
      turnId: params.turnId,
      serverName: params.serverName,
      message: params.message,
      url: params.url,
      elicitationId: params.elicitationId,
    };
  }

  const fields = Object.entries(params.requestedSchema.properties ?? {}).map(
    ([key, schema]) => ({
      key,
      label: ((schema as Record<string, unknown>).title as string) || key,
      description:
        ((schema as Record<string, unknown>).description as string | null) ??
        null,
      type: elicitationFieldType(
        schema as Record<string, unknown> | null | undefined,
      ),
      required: (params.requestedSchema.required ?? []).includes(key),
      defaultValue: normalizeElicitationDefault(
        (schema as Record<string, unknown>).default ?? null,
      ),
    }),
  );

  return {
    kind: "mcp-form",
    title: `MCP form from ${params.serverName}`,
    threadId: params.threadId,
    turnId: params.turnId,
    serverName: params.serverName,
    message: params.message,
    fields,
  };
}

function buildWorkspaceDynamicToolRequest(
  params: DynamicToolCallParams,
): WorkspaceDynamicToolRequest {
  return {
    kind: "dynamic-tool",
    title: `Dynamic tool call: ${params.tool}`,
    threadId: params.threadId,
    turnId: params.turnId,
    callId: params.callId,
    tool: params.tool,
    argumentsJson: JSON.stringify(params.arguments, null, 2),
  };
}

function elicitationFieldType(
  schema: Record<string, unknown> | null | undefined,
) {
  if (!schema || typeof schema.type !== "string") return "text" as const;
  if (schema.type === "integer" || schema.type === "number") {
    return "number" as const;
  }
  if (schema.type === "boolean") return "boolean" as const;
  return "text" as const;
}

function normalizeElicitationDefault(value: unknown) {
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  return null;
}

function summarizePermissions(params: PermissionsRequestApprovalParams) {
  const lines: string[] = [];
  const perms = params.permissions;
  if (perms.network?.enabled !== null && perms.network?.enabled !== undefined) {
    lines.push(`Network: ${perms.network.enabled ? "enabled" : "disabled"}`);
  }
  if (perms.fileSystem?.read?.length) {
    lines.push(`Read: ${perms.fileSystem.read.join(", ")}`);
  }
  if (perms.fileSystem?.write?.length) {
    lines.push(`Write: ${perms.fileSystem.write.join(", ")}`);
  }
  return lines.length > 0 ? lines : ["(no specific permissions)"];
}

function grantedPermissions(
  params: PermissionsRequestApprovalParams,
): GrantedPermissionProfile {
  return {
    network: params.permissions.network ?? undefined,
    fileSystem: params.permissions.fileSystem ?? undefined,
  };
}
