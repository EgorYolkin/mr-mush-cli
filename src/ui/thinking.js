import chalk from "chalk";

function formatElapsed(ms, i18n) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return m > 0
    ? i18n.t("thinking.elapsed.minutes", { minutes: m, seconds: s % 60 })
    : i18n.t("thinking.elapsed.seconds", { seconds: s });
}

export function startThinking(i18n, theme = {}) {
  const start = Date.now();
  const words = i18n.raw("thinking.words");
  const word = words[Math.floor(Math.random() * words.length)];
  const frames = theme.animation?.frames ?? ["◐", "◓", "◑", "◒"];
  const muted = theme.colors?.muted ?? chalk.dim;
  let frameIndex = 0;

  // Скрыть курсор во время анимации
  process.stdout.write("\x1b[?25l");

  const interval = setInterval(() => {
    const elapsed = formatElapsed(Date.now() - start, i18n);
    const frame = frames[frameIndex % frames.length];
    frameIndex += 1;
    const line = muted(
      i18n.t("thinking.line", {
        bullet: frame,
        word,
        elapsed,
      }),
    );

    process.stdout.write("\r" + line);
  }, 200);

  return function stop() {
    clearInterval(interval);
    // Восстановить курсор и очистить строку
    process.stdout.write("\r" + " ".repeat(process.stdout.columns || 80) + "\r");
    process.stdout.write("\x1b[?25h");
  };
}
