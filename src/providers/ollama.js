import { openAiCompatibleChat } from "./openai-compatible.js";

const DEFAULT_BASE_URL = "http://localhost:11434";

// Models known to support OpenAI-compatible tool calling via Ollama.
const TOOL_CAPABLE_MODELS = [
  "llama3.1",
  "llama3.2",
  "llama3.3",
  "qwen2.5",
  "qwen2.5-coder",
  "mistral",
  "mistral-nemo",
  "command-r",
  "command-r-plus",
  "firefunction",
  "hermes3",
];

export const ollamaProvider = {
  id: "ollama",
  label: "Ollama (local)",
  source: "api",
  binary: null,
  defaultModel: "gemma3:4b",
  // Capability depends on the loaded model — resolved at runtime.
  capabilities: { toolCalling: "dynamic" },

  /**
   * Check if the given model supports native tool calling.
   * First tries to detect via /api/show; falls back to known-model list.
   *
   * @param {string} modelName
   * @returns {Promise<boolean>}
   */
  async supportsToolCalling(modelName) {
    const baseUrl = resolveOllamaBaseUrl();
    try {
      const res = await fetch(`${baseUrl}/api/show`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: modelName }),
        signal: AbortSignal.timeout(2000),
      });
      if (res.ok) {
        const data = await res.json();
        // Ollama exposes a "capabilities" array on newer versions.
        if (Array.isArray(data.capabilities)) {
          return data.capabilities.includes("tools");
        }
        // Older versions: inspect template/modelfile for tool markers.
        const template = (data.template ?? data.modelfile ?? "").toLowerCase();
        if (template.includes("tools") || template.includes("function")) {
          return true;
        }
      }
    } catch {
      // Network error or timeout — fall through to known-model list.
    }
    const base = modelName.split(":")[0].toLowerCase();
    return TOOL_CAPABLE_MODELS.some((m) => base.startsWith(m));
  },

  async isAvailable() {
    const baseUrl = resolveOllamaBaseUrl();
    try {
      const res = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(1000) });
      return res.ok;
    } catch {
      return false;
    }
  },

  async fetchModels() {
    const baseUrl = resolveOllamaBaseUrl();
    const res = await fetch(`${baseUrl}/api/tags`);
    if (!res.ok) throw new Error(`Ollama API error: ${res.status}`);
    const { models } = await res.json();
    if (!models?.length) throw new Error("No models are loaded. Run: ollama pull <model>");
    return models.map((m) => ({ value: m.name, label: m.name }));
  },

  async exec(resolvedConfig, prompt, runtimeOverrides = {}, signal = null, options = {}) {
    const model = runtimeOverrides.model ?? resolvedConfig.activeModel;
    // Fallback timeout prevents indefinite hangs when Ollama freezes (OOM, GPU lock).
    const timeoutMs = resolvedConfig.tools?.bash?.timeout_ms ?? 30_000;
    const fallbackSignal = signal ?? AbortSignal.timeout(Math.max(timeoutMs * 10, 300_000));
    return openAiCompatibleChat({
      baseUrl: resolveOllamaBaseUrl(),
      providerName: "Ollama",
      model,
      prompt,
      promptStack: resolvedConfig.promptStack,
      messages: options.messages ?? null,
      signal: fallbackSignal,
      onToken: options.onToken,
      tools: options.tools ?? null,
    });
  },
};

export function resolveOllamaBaseUrl(env = process.env) {
  return env.MRMUSH_OLLAMA_BASE_URL ?? env.OLLAMA_HOST ?? DEFAULT_BASE_URL;
}
