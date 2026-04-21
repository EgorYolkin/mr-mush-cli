import { openaiProvider } from "./openai.js";
import { anthropicProvider } from "./anthropic.js";
import { googleProvider } from "./google.js";
import { ollamaProvider } from "./ollama.js";
import { lmstudioProvider } from "./lmstudio.js";

export const PROVIDERS = [openaiProvider, anthropicProvider, googleProvider, ollamaProvider, lmstudioProvider];

export function getProvider(id, i18n) {
  const provider = PROVIDERS.find((p) => p.id === id);
  if (!provider) {
    if (i18n) {
      throw new Error(i18n.t("errors.unknownProvider", { id }));
    }
    throw new Error(`Unknown provider: ${id}`);
  }
  return provider;
}

export function getProviderLabel(provider, i18n) {
  if (provider.labelKey) return i18n.t(provider.labelKey);
  return provider.label ?? provider.id;
}
