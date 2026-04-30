import { openAiCompatibleChat } from "./openai-compatible.js";

const BASE_URL = "https://api.deepseek.com";
const DEFAULT_MODELS = [
  { value: "deepseek-v4-flash", label: "deepseek-v4-flash" },
  { value: "deepseek-reasoner", label: "deepseek-reasoner" },
];

const THINKING_CONFIG_BY_LEVEL = {
  off: { thinking: { type: "disabled" } },
  minimal: {
    reasoning_effort: "high",
    thinking: { type: "enabled" },
  },
  low: {
    reasoning_effort: "high",
    thinking: { type: "enabled" },
  },
  medium: {
    reasoning_effort: "high",
    thinking: { type: "enabled" },
  },
  high: {
    reasoning_effort: "high",
    thinking: { type: "enabled" },
  },
  xhigh: {
    reasoning_effort: "max",
    thinking: { type: "enabled" },
  },
};

export const deepseekProvider = {
  id: "deepseek",
  labelKey: "providers.deepseek.label",
  source: "api",
  binary: "env",
  defaultModel: "deepseek-chat",
  capabilities: { toolCalling: "dynamic" },

  getAuthRequirements(resolvedConfig) {
    return resolvedConfig.auth.deepseek;
  },

  async isAvailable(resolvedConfig = null) {
    const envKey =
      resolvedConfig?.auth?.deepseek?.env_key ?? "DEEPSEEK_API_KEY";
    const configuredApiKey = resolvedConfig?.auth?.deepseek?.api_key;
    return Boolean(configuredApiKey || process.env[envKey]);
  },

  async fetchModels(resolvedConfig = null) {
    const envKey =
      resolvedConfig?.auth?.deepseek?.env_key ?? "DEEPSEEK_API_KEY";
    const i18n = resolvedConfig?.i18n ?? null;
    const apiKey =
      resolvedConfig?.auth?.deepseek?.api_key ?? process.env[envKey];
    if (!apiKey) {
      const message = i18n
        ? i18n.t("providers.deepseek.missingEnv", { envKey })
        : `Environment variable ${envKey} is not set`;
      throw new Error(message);
    }

    return DEFAULT_MODELS;
  },

  async supportsToolCalling(modelName) {
    return modelName !== "deepseek-reasoner";
  },

  async exec(
    resolvedConfig,
    prompt,
    runtimeOverrides = {},
    signal = null,
    options = {},
  ) {
    const model = runtimeOverrides.model ?? resolvedConfig.activeModel;
    const thinkingLevel =
      runtimeOverrides.thinkingLevel ?? resolvedConfig.thinkingLevel ?? "medium";
    const envKey = resolvedConfig.auth.deepseek.env_key;
    const apiKey = resolvedConfig.auth.deepseek.api_key ?? process.env[envKey];
    if (!apiKey) {
      throw new Error(
        resolvedConfig.i18n.t("providers.deepseek.missingEnv", { envKey }),
      );
    }

    return openAiCompatibleChat({
      baseUrl: BASE_URL,
      providerName: "DeepSeek",
      apiKey,
      model,
      prompt,
      promptStack: resolvedConfig.promptStack,
      messages: options.messages ?? null,
      signal,
      onToken: options.onToken,
      tools: options.tools ?? null,
      requestBodyExtras:
        THINKING_CONFIG_BY_LEVEL[thinkingLevel] ??
        THINKING_CONFIG_BY_LEVEL.medium,
    });
  },
};
