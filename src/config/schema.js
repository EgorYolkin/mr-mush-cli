import { z } from "zod";

export const PROVIDER_IDS = [
  "openai",
  "anthropic",
  "google",
  "deepseek",
  "ollama",
  "lmstudio",
];
export const PROFILE_IDS = ["default"];
export const THINKING_LEVELS = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
];
export const LEGACY_STATUSBAR_TEMPLATE =
  "{folder} | {model} | {thinking} | {tokens}";
export const DEFAULT_STATUSBAR_TEMPLATE =
  "{folder} | {model} | {thinking} | {messages} msgs | {session_tokens} out | {session_time}";
export const DEFAULT_USAGE_TEMPLATE = [
  "model: {model}",
  "project: {project}",
  "",
  "sessions: {sessions}",
  "messages (u/a): {messages_ua}",
  "",
  "input tokens: {input_tokens}",
  "output tokens: {output_tokens}",
].join("\n");

const providerIdSchema = z.enum(PROVIDER_IDS);
const profileIdSchema = z.enum(PROFILE_IDS);
const thinkingLevelSchema = z.enum(THINKING_LEVELS);

const providerSettingsSchema = z
  .object({
    model: z.string().min(1).optional(),
    reasoning_effort: thinkingLevelSchema.optional(),
    auth_env: z.string().min(1).optional(),
    enabled: z.boolean().optional(),
  })
  .strict();

const promptLayerPathsSchema = z
  .object({
    system: z.string().min(1).optional(),
    profile: z.record(z.string(), z.string().min(1)).optional(),
    provider: z.record(z.string(), z.string().min(1)).optional(),
  })
  .strict();

const uiSchema = z
  .object({
    theme: z.string().min(1).default("default"),
    show_context_meter: z.boolean().default(false),
    editor: z.string().min(1).optional(),
    message_dot: z.string().min(1).default("⬢"),
    statusbar_prompt: z.string().min(1).default(DEFAULT_STATUSBAR_TEMPLATE),
    usage_prompt: z.string().min(1).default(DEFAULT_USAGE_TEMPLATE),
  })
  .strict();

const reasoningSchema = z
  .object({
    default_effort: thinkingLevelSchema.default("medium"),
  })
  .strict();

const authSchema = z
  .object({
    openai: z
      .object({
        mode: z.enum(["cli", "env"]).default("cli"),
        env_key: z.string().min(1).default("OPENAI_API_KEY"),
      })
      .default({}),
    anthropic: z
      .object({
        mode: z.enum(["cli", "env"]).default("cli"),
        env_key: z.string().min(1).default("ANTHROPIC_API_KEY"),
      })
      .default({}),
    google: z
      .object({
        mode: z.enum(["env"]).default("env"),
        env_key: z.string().min(1).default("GEMINI_API_KEY"),
        api_key: z.string().min(1).optional(),
      })
      .default({}),
    deepseek: z
      .object({
        mode: z.enum(["env"]).default("env"),
        env_key: z.string().min(1).default("DEEPSEEK_API_KEY"),
        api_key: z.string().min(1).optional(),
      })
      .default({}),
  })
  .strict();

const cacheSchema = z
  .object({
    models_ttl_ms: z
      .number()
      .int()
      .positive()
      .default(60 * 60 * 1000),
  })
  .strict();

const orchestratorSchema = z
  .object({
    enabled: z.boolean().default(true),
    router_provider: providerIdSchema.default("anthropic"),
    router_model: z.string().min(1).default("claude-haiku-4-5-20251001"),
  })
  .strict();

const repoMapModeSchema = z.enum(["dense", "compact"]);

const intelligenceSchema = z
  .object({
    repo_map: z
      .object({
        enabled: z.boolean().default(true),
        mode: repoMapModeSchema.default("dense"),
        token_budget: z.number().int().positive().default(2000),
        max_symbols_per_file: z.number().int().positive().default(6),
        include_internal_symbols: z.boolean().default(true),
        denied_paths: z
          .array(z.string().min(1))
          .default([
            "test",
            "tests",
            "node_modules",
            ".git",
            ".mrmush",
            "coverage",
            "dist",
            "build",
          ]),
      })
      .default({}),
  })
  .strict();

const toolsSchema = z
  .object({
    force_markdown: z.boolean().default(false),
    bash: z
      .object({
        enabled: z.boolean().default(true),
        timeout_ms: z.number().int().positive().default(30_000),
        max_output_chars: z.number().int().positive().default(20_000),
        max_calls: z.number().int().positive().default(8),
        allowed_commands: z
          .array(z.string().min(1))
          .default([
            "pwd",
            "ls",
            "find",
            "rg",
            "cat",
            "sed",
            "head",
            "tail",
            "tree",
          ]),
        allowed_git_subcommands: z
          .array(z.string().min(1))
          .default(["status", "diff", "log", "show"]),
      })
      .default({}),
    files: z
      .object({
        write_enabled: z.boolean().default(true),
        max_file_size_kb: z.number().int().positive().default(512),
        denied_paths: z
          .array(z.string().min(1))
          .default([
            ".git",
            "node_modules",
            ".env",
            ".env.local",
            ".env.production",
          ]),
      })
      .default({}),
  })
  .default({});

const mcpServerSchema = z
  .object({
    enabled: z.boolean().default(false),
    transport: z.enum(["stdio", "http"]).default("stdio"),
    command: z.string().min(1).optional(),
    args: z.array(z.string()).default([]),
    url: z.string().url().optional(),
    env: z.record(z.string(), z.string()).default({}),
  })
  .strict();

const mcpShema = z
  .object({
    servers: z.record(z.string(), mcpServerSchema).default({}),
  })
  .default({});

export const userConfigSchema = z
  .object({
    schema_version: z.number().int().positive().default(1),
    active_provider: providerIdSchema.default("openai"),
    active_model: z.string().min(1).default("gpt-5.4"),
    active_profile: profileIdSchema.default("default"),
    ui: uiSchema.default({}),
    reasoning: reasoningSchema.default({}),
    auth: authSchema.default({}),
    cache: cacheSchema.default({}),
    orchestrator: orchestratorSchema.default({}),
    intelligence: intelligenceSchema.default({}),
    tools: toolsSchema,
    providers: z
      .object({
        openai: providerSettingsSchema.default({}),
        anthropic: providerSettingsSchema.default({}),
        google: providerSettingsSchema.default({}),
        deepseek: providerSettingsSchema.default({}),
        ollama: providerSettingsSchema.default({}),
        lmstudio: providerSettingsSchema.default({}),
      })
      .default({}),
    prompts: promptLayerPathsSchema.default({}),
    mcp: mcpShema,
  })
  .strict();

export const builtInConfig = Object.freeze(
  userConfigSchema.parse({
    schema_version: 1,
    active_provider: "openai",
    active_model: "gpt-5.4",
    active_profile: "default",
    reasoning: { default_effort: "medium" },
    cache: { models_ttl_ms: 60 * 60 * 1000 },
    orchestrator: {
      enabled: true,
      router_provider: "anthropic",
      router_model: "claude-haiku-4-5-20251001",
    },
    intelligence: {
      repo_map: {
        enabled: true,
        mode: "dense",
        token_budget: 2000,
        max_symbols_per_file: 6,
        include_internal_symbols: true,
        denied_paths: [
          "test",
          "tests",
          "node_modules",
          ".git",
          ".mrmush",
          "coverage",
          "dist",
          "build",
        ],
      },
    },
    tools: {
      bash: {
        enabled: true,
        timeout_ms: 30_000,
        max_output_chars: 20_000,
        max_calls: 8,
        allowed_commands: [
          "pwd",
          "ls",
          "find",
          "rg",
          "cat",
          "sed",
          "head",
          "tail",
          "tree",
        ],
        allowed_git_subcommands: ["status", "diff", "log", "show"],
      },
      files: {
        write_enabled: true,
        max_file_size_kb: 512,
        denied_paths: [
          ".git",
          "node_modules",
          ".env",
          ".env.local",
          ".env.production",
        ],
      },
    },
    auth: {
      openai: { mode: "cli", env_key: "OPENAI_API_KEY" },
      anthropic: { mode: "cli", env_key: "ANTHROPIC_API_KEY" },
      google: { mode: "env", env_key: "GEMINI_API_KEY" },
      deepseek: { mode: "env", env_key: "DEEPSEEK_API_KEY" },
    },
    providers: {
      openai: { model: "gpt-5.4", reasoning_effort: "medium", enabled: true },
      anthropic: {
        model: "claude-sonnet-4-6",
        reasoning_effort: "medium",
        enabled: true,
      },
      google: {
        model: "gemini-2.5-pro",
        reasoning_effort: "medium",
        enabled: false,
      },
      deepseek: {
        model: "deepseek-chat",
        reasoning_effort: "medium",
        enabled: false,
      },
    },
    mcp: {},
  }),
);

export function flattenZodIssues(error) {
  return error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join(".") : "<root>";
    return `${path}: ${issue.message}`;
  });
}
