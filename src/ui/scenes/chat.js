import readline from "node:readline";
import path from "node:path";
import chalk from "chalk";
import { getProvider } from "../../providers/index.js";
import { startThinking } from "../thinking.js";

// ─── Layout ───────────────────────────────────────────────────────────────────

function cols() {
  return process.stdout.columns || 80;
}

function divider() {
  process.stdout.write(chalk.dim("─".repeat(cols())) + "\n");
}

function statusBar(providerId, model) {
  const project = path.basename(process.cwd());
  const sep = chalk.dim(" | ");
  const parts = [
    chalk.bold(project),
    `${providerId}/${model}`,
    chalk.dim("ctx:–"),
    chalk.dim("5h:–"),
    chalk.dim("7d:–"),
  ];
  process.stdout.write("  " + parts.join(sep) + "\n");
}

// Рамка над инпутом: всегда перед ❯
function promptFrame(providerId, model) {
  divider();
  statusBar(providerId, model);
  process.stdout.write("\n");
}

// ─── Messages ─────────────────────────────────────────────────────────────────

function printAiMessage(text) {
  process.stdout.write("\n");
  divider();
  process.stdout.write("\n");
  for (const line of text.split("\n")) {
    process.stdout.write("  " + line + "\n");
  }
  process.stdout.write("\n");
}

// ─── Input ────────────────────────────────────────────────────────────────────

function readLine(rl) {
  return new Promise((resolve, reject) => {
    rl.question(chalk.cyan("❯ "), resolve);
    rl.once("close", () => reject(new Error("closed")));
  });
}

// ─── Main loop ────────────────────────────────────────────────────────────────

export async function runChatScreen(context) {
  const { model, providerId } = context.config;
  const provider = getProvider(providerId);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });

  rl.on("SIGINT", () => {
    process.stdout.write("\n");
    process.exit(0);
  });

  process.stdout.write("\n");
  promptFrame(providerId, model);

  while (true) {
    let text;
    try {
      text = (await readLine(rl)).trim();
    } catch {
      break;
    }

    if (!text) {
      promptFrame(providerId, model);
      continue;
    }

    // Анимация ожидания
    process.stdout.write("\n");
    const stopThinking = startThinking();

    let response;
    try {
      response = await provider.exec(model, text);
    } catch (err) {
      stopThinking();
      process.stdout.write("\n");
      process.stdout.write("  " + chalk.red("Ошибка: ") + err.message + "\n");
      promptFrame(providerId, model);
      continue;
    }

    stopThinking();
    printAiMessage(response.text);
    promptFrame(providerId, model);
  }

  rl.close();
}
