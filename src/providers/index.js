import { openaiProvider } from "./openai.js";
import { anthropicProvider } from "./anthropic.js";

export const PROVIDERS = [openaiProvider, anthropicProvider];

export function getProvider(id) {
  const provider = PROVIDERS.find((p) => p.id === id);
  if (!provider) throw new Error(`Unknown provider: ${id}`);
  return provider;
}
