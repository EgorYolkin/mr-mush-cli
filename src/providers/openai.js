import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const EFFORT_MAP = {
  off: null,
  minimal: "low",
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: "xhigh",
};

export const openaiProvider = {
  id: "openai",
  labelKey: "providers.openai.label",
  source: "cli",
  binary: "codex",
  defaultModel: "gpt-5.4",
  // Shells out to the codex CLI — no direct HTTP API, native tool calling unavailable.
  capabilities: { toolCalling: false },

  async fetchModels() {
    const { stdout } = await execFileAsync("codex", ["debug", "models"]);
    const { models } = JSON.parse(stdout);
    return models
      .filter((m) => m.visibility !== "hidden")
      .map((m) => ({ value: m.slug, label: m.display_name ?? m.slug }));
  },

  getAuthRequirements(resolvedConfig) {
    return resolvedConfig.auth.openai;
  },

  exec(resolvedConfig, prompt, runtimeOverrides = {}, signal = null) {
    const rawLevel =
      runtimeOverrides.thinkingLevel ?? resolvedConfig.thinkingLevel;
    // Use hasOwn so null ("off") does not fall through `??` to rawLevel.
    const effort = Object.hasOwn(EFFORT_MAP, rawLevel)
      ? EFFORT_MAP[rawLevel]
      : rawLevel;
    const model = runtimeOverrides.model ?? resolvedConfig.activeModel;
    const args = [
      "exec",
      "--json",
      "--ephemeral",
      "--skip-git-repo-check",
      "-m",
      model,
    ];
    if (effort) args.push("-c", `model_reasoning_effort="${effort}"`);
    const composedPrompt = resolvedConfig.promptStack?.text
      ? `${resolvedConfig.promptStack.text}\n\nUser request:\n${prompt}`
      : prompt;
    args.push(composedPrompt);

    return new Promise((resolve, reject) => {
      const child = spawn("codex", args, { stdio: ["ignore", "pipe", "pipe"] });

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

      let lastMessage = null;
      let usage = null;
      let buffer = "";

      child.stdout.on("data", (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop(); // Keep the incomplete line buffered until the next chunk.

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const event = JSON.parse(line);
            if (
              event.type === "item.completed" &&
              event.item?.type === "agent_message"
            ) {
              lastMessage = event.item.text;
            }
            if (event.type === "turn.completed") {
              usage = event.usage ?? null;
            }
          } catch {
            // Ignore non-JSON lines such as "Reading additional input from stdin...".
          }
        }
      });

      child.on("close", (code) => {
        if (lastMessage !== null) {
          resolve({ text: lastMessage, usage });
        } else {
          reject(
            new Error(
              resolvedConfig.i18n.t("providers.openai.execFailed", { code }),
            ),
          );
        }
      });

      child.on("error", reject);
    });
  },
};
