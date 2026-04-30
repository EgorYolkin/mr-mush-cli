import chalk from "chalk";
import { wrapText } from "./layout.js";
import { activeTheme, color, resolveSymbol } from "./theme.js";
import { renderMarkdown } from "./markdown.js";

// ─── Frame object contract ────────────────────────────────────────────────────
// Every build* function returns:
//   { text: string, blockHeight: number, cursorUpLines: number }
//
// Components never call process.stdout.write — that belongs to the scene.

// ─── Internal helpers ─────────────────────────────────────────────────────────

function buildMessageLines(text, width) {
  const lines = [];

  for (const rawLine of text.split("\n")) {
    // Only strip agents-tool fence markers; preserve legitimate code fences.
    const agentsFence = rawLine.match(/^```agents-tool\s*$/);
    if (agentsFence) continue;

    const wrapped = wrapText(rawLine, width, "");
    if (wrapped.length === 0) {
      lines.push("");
      continue;
    }

    lines.push(...wrapped);
  }

  while (lines.length > 1 && lines.at(-1) === "") {
    lines.pop();
  }

  return lines.length > 0 ? lines : [""];
}

export function stripToolMarkup(text) {
  return (text ?? "")
    .replace(/```agents-tool[\s\S]*?```/g, "")
    .replace(/```agents-tool[\s\S]*$/g, "")
    .trimEnd();
}

// ─── Frame builders ───────────────────────────────────────────────────────────

export function buildUserMessageFrame(text, context) {
  const symbol = resolveSymbol(context);
  const bodyLines = buildMessageLines(
    text,
    Math.max(1, (process.stdout.columns || 80) - 4),
  );
  const white = chalk.white;
  const lines = [`${white(`${symbol}\u00A0${bodyLines[0] ?? ""}`)}`];
  for (let index = 1; index < bodyLines.length; index += 1) {
    lines.push(`${white(`  ${bodyLines[index]}`)}`);
  }
  return {
    text: `${lines.join("\n")}\n\n`,
    blockHeight: lines.length + 1,
    cursorUpLines: lines.length + 1,
  };
}

export function buildAiMessageFrame(text, context) {
  const theme = activeTheme(context);
  const symbol = resolveSymbol(context);
  const accent = color(theme, "accent", chalk.magenta);
  const name = theme.layout?.agentName ?? "mr. mush";
  const contentWidth = Math.max(1, (process.stdout.columns || 80) - 4);

  // Strip tool markup first, then render markdown with syntax highlighting.
  const cleaned = stripToolMarkup(text).replace(/```agents-tool[\s\S]*?```/g, "").trimEnd();
  const bodyLines = renderMarkdown(cleaned, contentWidth);

  const lines = [`${accent(`${symbol}\u00A0${name}`)}`];
  for (const line of bodyLines) {
    lines.push(`${accent("  ")}${line}`);
  }
  return {
    text: `${lines.join("\n")}\n\n`,
    blockHeight: lines.length + 1,
    cursorUpLines: lines.length + 1,
  };
}

export function buildToolEventFrame(title, text, context) {
  const theme = activeTheme(context);
  const symbol = resolveSymbol(context);
  const muted = color(theme, "muted", chalk.dim);
  const contentWidth = Math.max(1, (process.stdout.columns || 80) - 4);
  const bodyLines = buildMessageLines(text, contentWidth);
  const lines = [`${muted(`${symbol}\u00A0${title}`)}`];
  for (const line of bodyLines) {
    lines.push(`${muted(`  ${line}`)}`);
  }
  return {
    text: `${lines.join("\n")}\n`,
    blockHeight: lines.length,
    cursorUpLines: lines.length,
  };
}

export function buildTerminalEventFrame(text, context) {
  const theme = activeTheme(context);
  const muted = color(theme, "muted", chalk.dim);
  const accent = color(theme, "accent", chalk.magenta);
  const symbol = resolveSymbol(context);
  const name = theme.layout?.agentName ?? "mr. mush";
  const contentWidth = Math.max(1, (process.stdout.columns || 80) - 4);
  const bodyLines = buildMessageLines(text, contentWidth);
  const lines = [`${accent(`${symbol}\u00A0${name}`)}`];

  for (const bodyLine of bodyLines) {
    const trimmed = bodyLine.trimStart();
    if (trimmed.startsWith("❯ ")) {
      // Command line: accent ❯ + bold command
      lines.push(`  ${accent("❯")} ${chalk.white.bold(trimmed.slice(2))}`);
    } else {
      // Output or description lines
      lines.push(muted(`  ${bodyLine}`));
    }
  }

  return {
    text: `${lines.join("\n")}\n\n`,
    blockHeight: lines.length + 1,
    cursorUpLines: lines.length + 1,
  };
}

export function buildExpandableTerminalEventFrame(entry, context) {
  const text = entry.meta?.expanded ? entry.meta.fullText : entry.text;
  const frame = buildTerminalEventFrame(text, context);
  if (entry.meta?.canExpand) {
    const theme = activeTheme(context);
    const muted = color(theme, "muted", chalk.dim);
    const symbol = resolveSymbol(context);
    const i18n = context.i18n;
    const hint = entry.meta.expanded
      ? i18n?.t("chat.terminal.collapseHint") ?? "Ctrl + O to collapse output"
      : i18n?.t("chat.terminal.expandHint") ?? "Ctrl + O to expand output";
    const hintLine = `\n${muted(`${symbol} ${hint}`)}\n\n`;
    return {
      text: frame.text + hintLine,
      blockHeight: frame.blockHeight + 3,
      cursorUpLines: frame.cursorUpLines + 3,
    };
  }
  return frame;
}

// ─── Tool event metadata ──────────────────────────────────────────────────────
// Produces the structured meta object consumed by appendAssistantMessage.

export function createTerminalEventMeta(toolCall, toolResult) {
  if (!toolCall) return null;

  if (toolCall.name === "bash") {
    const outputLines = [];
    const stdout = toolResult?.stdout?.trimEnd();
    const stderr = toolResult?.stderr?.trimEnd();

    if (stdout) {
      outputLines.push(...stdout.split("\n").map((line) => `  ${line}`));
    }
    if (stderr) {
      outputLines.push(...stderr.split("\n").map((line) => `  ${line}`));
    }
    if (outputLines.length === 0) {
      outputLines.push(
        toolResult?.blocked
          ? "  command blocked"
          : `  exit code: ${toolResult?.exit_code ?? "–"}`,
      );
    }

    const cmdLine = `❯ ${toolCall.args.cmd}`;
    const fullLines = [cmdLine, ...outputLines];
    const visibleOutputLines = outputLines.slice(0, 10);
    const collapsedLines = [cmdLine, ...visibleOutputLines];
    const canExpand = outputLines.length >= 10;

    return {
      kind: "terminal_event",
      text: collapsedLines.join("\n"),
      fullText: fullLines.join("\n"),
      canExpand,
      expanded: false,
    };
  }

  if (toolCall.name === "write_file") {
    const lines = [
      `❯ write_file ${toolCall.args.path}`,
    ];
    if (toolResult?.error?.trim()) {
      lines.push(
        ...toolResult.error
          .trim()
          .split("\n")
          .map((line) => `  ${line}`),
      );
    } else {
      lines.push(`  written: ${toolResult?.written ?? 0} bytes`);
    }
    return {
      kind: "terminal_event",
      text: lines.join("\n"),
      fullText: lines.join("\n"),
      canExpand: false,
      expanded: false,
    };
  }

  return null;
}
