import chalk from "chalk";

const WORDS = [
  "Thinking",
  "Reflecting",
  "Considering",
  "Processing",
  "Analyzing",
  "Reasoning",
  "Ebbing",
];

function formatElapsed(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}m ${s % 60}s` : `${s}s`;
}

export function startThinking() {
  const start = Date.now();
  const word = WORDS[Math.floor(Math.random() * WORDS.length)];

  // Скрыть курсор во время анимации
  process.stdout.write("\x1b[?25l");

  const interval = setInterval(() => {
    const elapsed = formatElapsed(Date.now() - start);
    const line =
      "  " +
      chalk.dim("·") +
      " " +
      chalk.dim(`${word}…`) +
      " " +
      chalk.dim(`(${elapsed})`);

    process.stdout.write("\r" + line);
  }, 200);

  return function stop() {
    clearInterval(interval);
    // Восстановить курсор и очистить строку
    process.stdout.write("\r" + " ".repeat(process.stdout.columns || 80) + "\r");
    process.stdout.write("\x1b[?25h");
  };
}
