import { z } from "zod";

export const PROVIDER_IDS = ["openai", "anthropic", "google", "ollama", "lmstudio"];
export const PROFILE_IDS = ["default"];
export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh"];

const providerIdSchema = z.enum(PROVIDER_IDS);
const profileIdSchema = z.enum(PROFILE_IDS);
const thinkingLevelSchema = z.enum(THINKING_LEVELS);

const providerSettingsSchema = z.object({
  model: z.string().min(1).optional(),
  reasoning_effort: thinkingLevelSchema.optional(),
  auth_env: z.string().min(1).optional(),
  enabled: z.boolean().optional(),
}).strict();

const promptLayerPathsSchema = z.object({
  system: z.string().min(1).optional(),
  profile: z.record(z.string(), z.string().min(1)).optional(),
  provider: z.record(z.string(), z.string().min(1)).optional(),
}).strict();

const uiSchema = z.object({
  theme: z.string().min(1).default("default"),
  show_context_meter: z.boolean().default(false),
  editor: z.string().min(1).optional(),
  message_dot: z.string().min(1).default("⬢"),
  statusbar_prompt: z.string().min(1).default("{folder} | {model} | {thinking} | {tokens}"),
}).strict();

const reasoningSchema = z.object({
  default_effort: thinkingLevelSchema.default("medium"),
}).strict();

const authSchema = z.object({
  openai: z.object({
    mode: z.enum(["cli", "env"]).default("cli"),
    env_key: z.string().min(1).default("OPENAI_API_KEY"),
  }).default({}),
  anthropic: z.object({
    mode: z.enum(["cli", "env"]).default("cli"),
    env_key: z.string().min(1).default("ANTHROPIC_API_KEY"),
  }).default({}),
  google: z.object({
    mode: z.enum(["env"]).default("env"),
    env_key: z.string().min(1).default("GEMINI_API_KEY"),
  }).default({}),
}).strict();

const cacheSchema = z.object({
  models_ttl_ms: z.number().int().positive().default(60 * 60 * 1000),
}).strict();

const toolsSchema = z.object({
  bash: z.object({
    enabled: z.boolean().default(true),
    timeout_ms: z.number().int().positive().default(30_000),
    max_output_chars: z.number().int().positive().default(20_000),
    max_calls: z.number().int().positive().default(3),
  }).default({}),
}).default({});

export const userConfigSchema = z.object({
  schema_version: z.number().int().positive().default(1),
  active_provider: providerIdSchema.default("openai"),
  active_model: z.string().min(1).default("gpt-5.4"),
  active_profile: profileIdSchema.default("default"),
  ui: uiSchema.default({}),
  reasoning: reasoningSchema.default({}),
  auth: authSchema.default({}),
  cache: cacheSchema.default({}),
  tools: toolsSchema,
  providers: z.object({
    openai: providerSettingsSchema.default({}),
    anthropic: providerSettingsSchema.default({}),
    google: providerSettingsSchema.default({}),
    ollama: providerSettingsSchema.default({}),
    lmstudio: providerSettingsSchema.default({}),
  }).default({}),
  prompts: promptLayerPathsSchema.default({}),
}).strict();

export const builtInConfig = Object.freeze(userConfigSchema.parse({
  schema_version: 1,
  active_provider: "openai",
  active_model: "gpt-5.4",
  active_profile: "default",
  reasoning: { default_effort: "medium" },
  cache: { models_ttl_ms: 60 * 60 * 1000 },
  tools: {
    bash: {
      enabled: true,
      timeout_ms: 30_000,
      max_output_chars: 20_000,
      max_calls: 3,
    },
  },
  auth: {
    openai: { mode: "cli", env_key: "OPENAI_API_KEY" },
    anthropic: { mode: "cli", env_key: "ANTHROPIC_API_KEY" },
    google: { mode: "env", env_key: "GEMINI_API_KEY" },
  },
  providers: {
    openai: { model: "gpt-5.4", reasoning_effort: "medium", enabled: true },
    anthropic: { model: "claude-sonnet-4-6", reasoning_effort: "medium", enabled: true },
    google: { model: "gemini-2.5-pro", reasoning_effort: "medium", enabled: false },
  },
}));

export function flattenZodIssues(error) {
  return error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join(".") : "<root>";
    return `${path}: ${issue.message}`;
  });
}
