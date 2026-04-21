import { spawn } from "node:child_process";

const MODELS = [
  { value: "claude-opus-4-6", label: "Claude Opus 4.6" },
  { value: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
  { value: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5" },
];

export const anthropicProvider = {
  id: "anthropic",
  labelKey: "providers.anthropic.label",
  source: "cli",
  binary: "claude",
  defaultModel: "claude-sonnet-4-6",

  async fetchModels() {
    return MODELS;
  },

  getAuthRequirements(resolvedConfig) {
    return resolvedConfig.auth.anthropic;
  },

  exec(resolvedConfig, prompt, runtimeOverrides = {}, signal = null) {
    const model = runtimeOverrides.model ?? resolvedConfig.activeModel;
    const effort =
      runtimeOverrides.thinkingLevel ?? resolvedConfig.thinkingLevel;
    const args = [
      "--print",
      "--output-format",
      "json",
      "--model",
      model,
      "--effort",
      effort === "xhigh" ? "max" : (effort ?? "medium"),
      "--append-system-prompt",
      resolvedConfig.promptStack?.text ?? "",
      prompt,
    ];

    return new Promise((resolve, reject) => {
      const child = spawn("claude", args, {
        stdio: ["ignore", "pipe", "pipe"],
      });

      if (signal) {
        signal.addEventListener(
          "abort",
          () => {
            child.kill("SIGINT");
            reject(new Error("cancelled"));
          },
          { once: true },
        );
      }

      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });

      child.on("close", (code) => {
        if (code !== 0) {
          reject(
            new Error(
              stderr.trim() ||
                resolvedConfig.i18n.t("providers.anthropic.execFailed", {
                  code,
                }),
            ),
          );
          return;
        }
        try {
          const parsed = JSON.parse(stdout);
          resolve({
            text: parsed.result ?? parsed.message ?? stdout.trim(),
            usage: parsed.usage ?? null,
          });
        } catch {
          resolve({ text: stdout.trim(), usage: null });
        }
      });

      child.on("error", reject);
    });
  },
};
