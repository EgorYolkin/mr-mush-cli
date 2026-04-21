import { openAiCompatibleChat } from "./openai-compatible.js";

const BASE_URL = "http://localhost:1234";

export const lmstudioProvider = {
  id: "lmstudio",
  label: "LM Studio (local)",
  source: "api",
  binary: null,
  defaultModel: "local-model",

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
    if (!data?.length) throw new Error("Нет загруженных моделей в LM Studio");
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
      signal,
      onToken: options.onToken,
    });
  },
};
