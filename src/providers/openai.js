import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const openaiProvider = {
  id: "openai",
  label: "OpenAI / Codex",
  source: "cli",
  binary: "codex",

  async fetchModels() {
    const { stdout } = await execFileAsync("codex", ["debug", "models"]);
    const { models } = JSON.parse(stdout);
    return models
      .filter((m) => m.visibility !== "hidden")
      .map((m) => ({ value: m.slug, label: m.display_name ?? m.slug }));
  },

  // Возвращает Promise<{ text: string, usage: object }>
  exec(model, prompt) {
    return new Promise((resolve, reject) => {
      const child = spawn(
        "codex",
        [
          "exec",
          "--json",
          "--ephemeral",
          "--skip-git-repo-check",
          "-m", model,
          prompt,
        ],
        { stdio: ["ignore", "pipe", "pipe"] },
      );

      let lastMessage = null;
      let usage = null;
      let buffer = "";

      child.stdout.on("data", (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop(); // незавершённая строка остаётся в буфере

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
            // не JSON-строка (например, "Reading additional input from stdin...")
          }
        }
      });

      child.on("close", (code) => {
        if (lastMessage !== null) {
          resolve({ text: lastMessage, usage });
        } else {
          reject(new Error(`codex exec завершился с кодом ${code}`));
        }
      });

      child.on("error", reject);
    });
  },
};
