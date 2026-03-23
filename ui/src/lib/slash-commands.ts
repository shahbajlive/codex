export type SlashCommandDefinition = {
  command: string;
  description: string;
  supportsInlineArgs: boolean;
};

export const slashCommands: SlashCommandDefinition[] = [
  {
    command: "/model",
    description: "choose what model and reasoning effort to use",
    supportsInlineArgs: false,
  },
  {
    command: "/fast",
    description:
      "toggle Fast mode to enable fastest inference at 2X plan usage",
    supportsInlineArgs: true,
  },
  {
    command: "/approvals",
    description: "choose what Codex is allowed to do",
    supportsInlineArgs: false,
  },
  {
    command: "/permissions",
    description: "choose what Codex is allowed to do",
    supportsInlineArgs: false,
  },
  {
    command: "/setup-default-sandbox",
    description: "set up elevated agent sandbox",
    supportsInlineArgs: false,
  },
  {
    command: "/experimental",
    description: "toggle experimental features",
    supportsInlineArgs: false,
  },
  {
    command: "/skills",
    description: "use skills to improve how Codex performs specific tasks",
    supportsInlineArgs: false,
  },
  {
    command: "/review",
    description: "review my current changes and find issues",
    supportsInlineArgs: true,
  },
  {
    command: "/rename",
    description: "rename the current thread",
    supportsInlineArgs: true,
  },
  {
    command: "/new",
    description: "start a new chat during a conversation",
    supportsInlineArgs: false,
  },
  {
    command: "/resume",
    description: "resume a saved chat",
    supportsInlineArgs: false,
  },
  {
    command: "/fork",
    description: "fork the current chat",
    supportsInlineArgs: false,
  },
  {
    command: "/init",
    description: "create an AGENTS.md file with instructions for Codex",
    supportsInlineArgs: false,
  },
  {
    command: "/compact",
    description: "summarize conversation to prevent hitting the context limit",
    supportsInlineArgs: false,
  },
  {
    command: "/plan",
    description: "switch to Plan mode",
    supportsInlineArgs: true,
  },
  {
    command: "/collab",
    description: "change collaboration mode (experimental)",
    supportsInlineArgs: false,
  },
  {
    command: "/agent",
    description: "switch the active agent thread",
    supportsInlineArgs: false,
  },
  {
    command: "/diff",
    description: "show git diff (including untracked files)",
    supportsInlineArgs: false,
  },
  {
    command: "/copy",
    description: "copy the latest Codex output to your clipboard",
    supportsInlineArgs: false,
  },
  {
    command: "/mention",
    description: "mention a file",
    supportsInlineArgs: false,
  },
  {
    command: "/status",
    description: "show current session configuration and token usage",
    supportsInlineArgs: false,
  },
  {
    command: "/debug-config",
    description: "show config layers and requirement sources for debugging",
    supportsInlineArgs: false,
  },
  {
    command: "/statusline",
    description: "configure which items appear in the status line",
    supportsInlineArgs: false,
  },
  {
    command: "/theme",
    description: "choose a syntax highlighting theme",
    supportsInlineArgs: false,
  },
  {
    command: "/mcp",
    description: "list configured MCP tools",
    supportsInlineArgs: false,
  },
  { command: "/apps", description: "manage apps", supportsInlineArgs: false },
  {
    command: "/plugins",
    description: "browse plugins",
    supportsInlineArgs: false,
  },
  {
    command: "/logout",
    description: "log out of Codex",
    supportsInlineArgs: false,
  },
  { command: "/quit", description: "exit Codex", supportsInlineArgs: false },
  { command: "/exit", description: "exit Codex", supportsInlineArgs: false },
  {
    command: "/feedback",
    description: "send logs to maintainers",
    supportsInlineArgs: false,
  },
  {
    command: "/ps",
    description: "list background terminals",
    supportsInlineArgs: false,
  },
  {
    command: "/stop",
    description: "stop all background terminals",
    supportsInlineArgs: false,
  },
  {
    command: "/clear",
    description: "clear the terminal and start a new chat",
    supportsInlineArgs: false,
  },
  {
    command: "/personality",
    description: "choose a communication style for Codex",
    supportsInlineArgs: false,
  },
  {
    command: "/realtime",
    description: "toggle realtime voice mode (experimental)",
    supportsInlineArgs: false,
  },
  {
    command: "/settings",
    description: "configure realtime microphone/speaker",
    supportsInlineArgs: false,
  },
  {
    command: "/subagents",
    description: "switch the active agent thread",
    supportsInlineArgs: false,
  },
];
