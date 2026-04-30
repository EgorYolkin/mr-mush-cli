/**
 * @file Provider interface definition and runtime validation.
 *
 * Every provider module must export an object conforming to ProviderInterface.
 * This file provides the canonical typedef and a validation helper.
 */

/**
 * @typedef {'api' | 'local' | 'binary'} ProviderSource
 */

/**
 * Tool calling capability flag.
 * - true    — always supports native tool calling.
 * - false   — never supports native tool calling; uses markdown fallback.
 * - 'dynamic' — capability depends on the loaded model (e.g. Ollama).
 *
 * @typedef {boolean | 'dynamic'} ToolCallingCapability
 */

/**
 * @typedef {object} ProviderInterface
 *
 * @property {string}                 id           Unique identifier (e.g. "openai", "ollama").
 * @property {string}                 label        Human-readable label.
 * @property {string}                 [labelKey]   i18n key for the label (optional).
 * @property {ProviderSource}         source       Whether the provider is API-based, local, or binary.
 * @property {string|null}            binary       Binary name for binary-based providers.
 * @property {string}                 defaultModel Default model identifier.
 * @property {{ toolCalling: ToolCallingCapability }} capabilities
 *
 * @property {(resolvedConfig: object, prompt: string, runtimeOverrides?: object, signal?: AbortSignal|null, options?: object) => Promise<{ text: string, usage: object|null, toolCalls?: object[], assistantMessage?: object }>} exec
 *   Execute a chat completion. Returns text response and optional usage/tool calls.
 *
 * @property {() => Promise<boolean>} isAvailable
 *   Check if the provider is reachable (e.g. local server running).
 *
 * @property {() => Promise<Array<{ value: string, label: string }>>} fetchModels
 *   Fetch available models from the provider.
 *
 * @property {(modelName: string) => Promise<boolean>} [supportsToolCalling]
 *   (Optional) Dynamic check for native tool calling support.
 */

const REQUIRED_FIELDS = ["id", "label", "source", "defaultModel", "capabilities", "exec", "isAvailable", "fetchModels"];
const REQUIRED_FUNCTIONS = ["exec", "isAvailable", "fetchModels"];

/**
 * Validate that a provider object conforms to ProviderInterface.
 *
 * @param {object} provider
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateProvider(provider) {
  const errors = [];

  if (!provider || typeof provider !== "object") {
    return { valid: false, errors: ["Provider must be an object"] };
  }

  for (const field of REQUIRED_FIELDS) {
    if (provider[field] === undefined || provider[field] === null) {
      errors.push(`Missing required field: ${field}`);
    }
  }

  for (const fn of REQUIRED_FUNCTIONS) {
    if (typeof provider[fn] !== "function") {
      errors.push(`${fn} must be a function`);
    }
  }

  if (provider.capabilities) {
    const tc = provider.capabilities.toolCalling;
    if (tc !== true && tc !== false && tc !== "dynamic") {
      errors.push(`capabilities.toolCalling must be true, false, or "dynamic"; got ${JSON.stringify(tc)}`);
    }
  }

  if (provider.supportsToolCalling !== undefined && typeof provider.supportsToolCalling !== "function") {
    errors.push("supportsToolCalling must be a function if provided");
  }

  return { valid: errors.length === 0, errors };
}
