const MODELS = [
  { value: "claude-opus-4-6", label: "Claude Opus 4.6" },
  { value: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
  { value: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5" },
];

export const anthropicProvider = {
  id: "anthropic",
  label: "Anthropic Claude",
  source: "cli",
  binary: "claude",

  async fetchModels() {
    return MODELS;
  },
};
