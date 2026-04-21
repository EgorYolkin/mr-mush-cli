import { openAiCompatibleChat } from "./openai-compatible.js";

const BASE_URL = "http://localhost:11434";

export const ollamaProvider = {
  id: "ollama",
  label: "Ollama (local)",
  source: "api",
  binary: null,
  defaultModel: "gemma3:4b",

  async isAvailable() {
    try {
      const res = await fetch(`${BASE_URL}/api/tags`, { signal: AbortSignal.timeout(1000) });
      return res.ok;
    } catch {
      return false;
    }
  },

  async fetchModels() {
    const res = await fetch(`${BASE_URL}/api/tags`);
    if (!res.ok) throw new Error(`Ollama API error: ${res.status}`);
    const { models } = await res.json();
    if (!models?.length) throw new Error("Нет загруженных моделей. Запусти: ollama pull <model>");
    return models.map((m) => ({ value: m.name, label: m.name }));
  },

  async exec(resolvedConfig, prompt, runtimeOverrides = {}, signal = null, options = {}) {
    const model = runtimeOverrides.model ?? resolvedConfig.activeModel;
    return openAiCompatibleChat({
      baseUrl: BASE_URL,
      providerName: "Ollama",
      model,
      prompt,
      promptStack: resolvedConfig.promptStack,
      signal,
      onToken: options.onToken,
    });
  },
};
