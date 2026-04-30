import { openAiCompatibleChat } from "./openai-compatible.js";

const BASE_URL = "http://localhost:1234";

export const lmstudioProvider = {
  id: "lmstudio",
  label: "LM Studio (local)",
  source: "api",
  binary: null,
  defaultModel: "local-model",
  // LM Studio supports OpenAI-compatible tool calling for capable models (v0.3+).
  // Use 'dynamic' so the user can override via force_markdown if their model doesn't support it.
  capabilities: { toolCalling: "dynamic" },

  /**
   * LM Studio doesn't expose a capability API — we optimistically try native tool calling.
   * If the model doesn't support tools, the API returns no tool_calls and we fall through gracefully.
   *
   * @returns {Promise<boolean>}
   */
  async supportsToolCalling() {
    return true;
  },

  async isAvailable() {
    try {
      const res = await fetch(`${BASE_URL}/v1/models`, { signal: AbortSignal.timeout(1000) });
      return res.ok;
    } catch {
      return false;
    }
  },

  async fetchModels() {
    const res = await fetch(`${BASE_URL}/v1/models`);
    if (!res.ok) throw new Error(`LM Studio API error: ${res.status}`);
    const { data } = await res.json();
    if (!data?.length) throw new Error("No models are loaded in LM Studio");
    return data.map((m) => ({ value: m.id, label: m.id }));
  },

  async exec(resolvedConfig, prompt, runtimeOverrides = {}, signal = null, options = {}) {
    const model = runtimeOverrides.model ?? resolvedConfig.activeModel;
    return openAiCompatibleChat({
      baseUrl: BASE_URL,
      providerName: "LM Studio",
      model,
      prompt,
      promptStack: resolvedConfig.promptStack,
      messages: options.messages ?? null,
      signal,
      onToken: options.onToken,
      tools: options.tools ?? null,
    });
  },
};
