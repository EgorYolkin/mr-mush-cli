import os from "node:os";
import path from "node:path";
import chalk from "chalk";
import { getProvider } from "../../providers/index.js";
import { createPassiveInputBuffer, promptInput } from "../input.js";
import { executeCommand } from "../../commands/index.js";
import { loadConfig, saveState } from "../../config/loader.js";
import { runProviderWithTools } from "../../tools/orchestrator.js";

// ─── Layout ───────────────────────────────────────────────────────────────────

function activeTheme(context) {
  return context.ui?.theme ?? {};
}

function color(theme, name, fallback = chalk.white) {
  return theme.colors?.[name] ?? fallback;
}

function frameWidth() {
  return Math.min(Math.max(72, process.stdout.columns || 96), 92);
}

function wrapText(text, width, indent) {
  const rows = [];
  const maxWidth = Math.max(24, width);

  for (const rawLine of text.split("\n")) {
    const words = rawLine.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      rows.push("");
      continue;
    }

    let line = "";
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (next.length > maxWidth && line) {
        rows.push(line);
        line = `${indent}${word}`;
      } else {
        line = next;
      }
    }
    rows.push(line);
  }

  return rows;
}

function visibleLength(value) {
  return value.length;
}

function fitText(value, width) {
  const length = visibleLength(value);
  if (length <= width) return value + " ".repeat(width - length);
  if (width <= 1) return " ".repeat(width);
  return `${value.slice(0, width - 1)}…`;
}

function centerPlain(value, width) {
  const fitted = visibleLength(value) > width ? fitText(value, width) : value;
  const left = Math.floor((width - visibleLength(fitted)) / 2);
  const right = width - visibleLength(fitted) - left;
  return `${" ".repeat(left)}${fitted}${" ".repeat(right)}`;
}

function centerBlock(lines, width) {
  const blockWidth = Math.max(...lines.map((line) => visibleLength(line)));
  const blockLeft = Math.max(0, Math.floor((width - blockWidth) / 2));

  return lines.map((line) => {
    const paddedLine = line + " ".repeat(blockWidth - visibleLength(line));
    return `${" ".repeat(blockLeft)}${paddedLine}${" ".repeat(width - blockLeft - blockWidth)}`;
  });
}

function formatCwd(cwd) {
  const home = os.homedir();
  return cwd.startsWith(home) ? `~${cwd.slice(home.length)}` : cwd;
}

function formatFolder(cwd) {
  return path.basename(cwd) || cwd;
}

function formatTokenCount(value) {
  if (!Number.isFinite(value)) return "–";
  if (value >= 1000000) return `${(value / 1000000).toFixed(1)}m`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return String(value);
}

function extractTotalTokens(usage) {
  if (!usage) return null;
  const direct =
    usage.total_tokens ??
    usage.totalTokens ??
    usage.totalTokenCount ??
    usage.total_tokens_count;
  if (Number.isFinite(direct)) return direct;

  const input =
    usage.input_tokens ??
    usage.prompt_tokens ??
    usage.inputTokens ??
    usage.promptTokenCount ??
    usage.inputTokenCount;
  const output =
    usage.output_tokens ??
    usage.completion_tokens ??
    usage.outputTokens ??
    usage.candidatesTokenCount ??
    usage.outputTokenCount;

  if (Number.isFinite(input) || Number.isFinite(output)) {
    return (input ?? 0) + (output ?? 0);
  }

  return null;
}

function formatUsage(usage) {
  return formatTokenCount(extractTotalTokens(usage));
}

function inputStatus(context, tokens) {
  return {
    folder: formatFolder(context.cwd ?? process.cwd()),
    model: context.runtimeOverrides.model ?? context.config.activeModel,
    thinking:
      context.runtimeOverrides.thinkingLevel ??
      context.config.thinkingLevel ??
      "medium",
    tokens,
    template:
      context.runtimeOverrides.config?.ui?.statusbar_prompt ??
      context.config.ui?.statusbar_prompt,
  };
}

function frameLine(theme, content) {
  const frame = theme.symbols?.frame ?? {};
  const vertical = frame.vertical ?? "│";
  const border = color(theme, "border", chalk.dim);
  return `${border(vertical)}${content}${border(vertical)}`;
}

function splash(context) {
  const theme = activeTheme(context);
  const art = theme.layout?.splash ?? [];
  if (art.length === 0) return;

  const frame = theme.symbols?.frame ?? {};
  const horizontal = frame.horizontal ?? "─";
  const topLeft = frame.topLeft ?? "╭";
  const topRight = frame.topRight ?? "╮";
  const bottomLeft = frame.bottomLeft ?? "╰";
  const bottomRight = frame.bottomRight ?? "╯";
  const border = color(theme, "border", chalk.dim);
  const accent = color(theme, "accent", chalk.magenta);
  const muted = color(theme, "muted", chalk.dim);
  const width = frameWidth();
  const innerWidth = width - 2;
  const model = context.runtimeOverrides.model ?? context.config.activeModel;
  const level = context.runtimeOverrides.thinkingLevel ?? context.config.thinkingLevel ?? "medium";
  const provider = context.runtimeOverrides.providerId ?? context.config.activeProvider;
  const cwd = formatCwd(context.cwd ?? process.cwd());
  const titleText = ` ${theme.layout?.splashTitle ?? "AGENTS ENGINE"} `;
  const topRuleWidth = width - titleText.length - 2;

  process.stdout.write(
    border(topLeft + horizontal.repeat(3)) +
      accent(titleText) +
      border(horizontal.repeat(Math.max(0, topRuleWidth - 3)) + topRight) +
      "\n",
  );

  const artRows = centerBlock(art, innerWidth);
  const rows = [
    { text: "" },
    ...artRows.map((line) => ({ text: line, paint: accent, prefit: true })),
    { text: "" },
    { text: `${provider}/${model} with ${level} effort`, paint: muted },
    { text: cwd, paint: muted },
  ];

  for (const row of rows) {
    const content = row.prefit ? row.text : centerPlain(row.text, innerWidth);
    process.stdout.write(frameLine(theme, row.paint ? row.paint(content) : content) + "\n");
  }

  process.stdout.write(
    border(bottomLeft + horizontal.repeat(width - 2) + bottomRight) + "\n",
  );
  process.stdout.write("\n");
}

// ─── Messages — вне рамки ─────────────────────────────────────────────────────

function printUserMessage(text, context) {
  const theme = activeTheme(context);
  const transcriptIndent = theme.layout?.transcriptIndent ?? "  ";
  const symbol = context.config.ui?.message_dot ?? theme.symbols?.messageDot ?? "⬢";
  const plainLabel = context.i18n.t("chat.labels.you");
  const label = color(theme, "accent", chalk.magenta)(plainLabel);
  const labelText = symbol ? `${symbol} ${label}` : label;
  const bodyIndent = theme.layout?.messageIndent ?? "  ";
  const width = (process.stdout.columns || 80) - bodyIndent.length;
  const lines = wrapText(text, width, "");

  process.stdout.write(`${transcriptIndent}${labelText}\n`);
  lines.forEach((line) => {
    process.stdout.write(`${transcriptIndent}${bodyIndent}${line}\n`);
  });
}

function printAiMessage(text, context) {
  const theme = activeTheme(context);
  const transcriptIndent = theme.layout?.transcriptIndent ?? "  ";
  const symbol = context.config.ui?.message_dot ?? theme.symbols?.messageDot ?? "⬢";
  const label = color(theme, "accent", chalk.magenta)(theme.layout?.agentName ?? "mr. mush");
  const labelText = symbol ? `${symbol} ${label}` : label;
  const bodyIndent = theme.layout?.messageIndent ?? "  ";
  const width = (process.stdout.columns || 80) - bodyIndent.length;
  process.stdout.write(`${transcriptIndent}${labelText}\n`);
  return 1 + printMessageBody(text, {
    prefix: `${transcriptIndent}${bodyIndent}`,
    width,
  });
}

function highlightCodeLine(line) {
  return line
    .replace(/\b(const|let|var|function|return|if|else|for|while|import|from|export|class|async|await|def|print|in|try|except)\b/g, (match) => chalk.hex("#c084fc")(match))
    .replace(/(["'`])([^"'`]*)(\1)/g, (match) => chalk.green(match))
    .replace(/\b(\d+)\b/g, (match) => chalk.yellow(match));
}

function printMessageBody(text, { prefix, width }) {
  let inCode = false;
  let count = 0;

  for (const rawLine of text.split("\n")) {
    const fence = rawLine.match(/^```(\w+)?\s*$/);
    if (fence) {
      inCode = !inCode;
      continue;
    }

    if (inCode) {
      process.stdout.write(`${prefix}${chalk.dim("│ ")}${highlightCodeLine(rawLine)}\n`);
      count += 1;
      continue;
    }

    const lines = wrapText(rawLine, width, "");
    for (const line of lines) {
      process.stdout.write(`${prefix}${line}\n`);
      count += 1;
    }
  }

  return count;
}

// ─── Main loop ────────────────────────────────────────────────────────────────

export async function runChatScreen(context) {
  const { i18n } = context;
  process.stdout.write("\n");
  splash(context);
  let queuedInput = "";
  let lastTokens = "–";

  while (true) {
    const providerId = context.runtimeOverrides.providerId ?? context.config.activeProvider;
    const model = context.runtimeOverrides.model ?? context.config.activeModel;
    const provider = getProvider(providerId, i18n);

    let text;
    try {
      text = (
        await promptInput(
          i18n,
          activeTheme(context),
          queuedInput,
          inputStatus(context, lastTokens),
        )
      ).trim();
      queuedInput = "";
    } catch {
      break;
    }

    if (!text) {
      continue;
    }

    // Команды
    if (text.startsWith("/")) {
      await executeCommand(text, context);
      context.config = await loadConfig({
        cwd: context.cwd,
        runtimeOverrides: context.runtimeOverrides,
      });
      continue;
    }

    printUserMessage(text, context);
    process.stdout.write("\n");
    const abort = new AbortController();
    const passiveInput = createPassiveInputBuffer(i18n, activeTheme(context), {
      onEscape: () => abort.abort(),
      status: inputStatus(context, lastTokens),
    });
    const stopThinking = () => {};
    const shouldStream = provider.source !== "cli";
    let streamedText = "";
    let renderedResponseLines = 0;
    let hasStoppedThinking = false;
    let inputVisible = true;

    function stopThinkingOnce() {
      if (hasStoppedThinking) return;
      stopThinking();
      hasStoppedThinking = true;
    }

    function clearVisibleInput() {
      if (!inputVisible) return;
      queuedInput = passiveInput.getBuffer();
      passiveInput.clear();
      inputVisible = false;
    }

    function redrawInputBelow() {
      passiveInput.render();
      inputVisible = true;
    }

    function clearRenderedResponse() {
      if (renderedResponseLines === 0) return;
      process.stdout.write(`\x1b[${renderedResponseLines}A\r\x1b[J`);
      renderedResponseLines = 0;
    }

    function renderStreamingFrame() {
      clearVisibleInput();
      clearRenderedResponse();
      renderedResponseLines = printAiMessage(streamedText, context);
      redrawInputBelow();
    }

    let response;
    try {
      response = await runProviderWithTools({
        provider,
        config: context.config,
        prompt: text,
        runtimeOverrides: context.runtimeOverrides,
        signal: abort.signal,
        context,
        onToken: shouldStream
          ? (token) => {
              stopThinkingOnce();
              streamedText += token;
              renderStreamingFrame();
            }
          : null,
        beforeApproval: () => {
          clearVisibleInput();
          queuedInput = passiveInput.stop();
        },
        afterApproval: () => {
          passiveInput.render();
          inputVisible = true;
        },
        beforeToolCall: () => {
          clearVisibleInput();
          clearRenderedResponse();
        },
      });
      lastTokens = formatUsage(response.usage);
      await saveState({
        ...context.config.state,
        schemaVersion: context.config.schema_version,
        lastUsedProvider: providerId,
        lastUsedModel: model,
        lastUsedProfile: context.runtimeOverrides.profile ?? context.config.activeProfile,
        lastPromptAt: new Date().toISOString(),
      }, context.config.paths);
    } catch (err) {
      stopThinkingOnce();
      clearVisibleInput();
      queuedInput = passiveInput.stop();
      if (abort.signal.aborted) {
        process.stdout.write(
          "\r\x1b[J\n  " + chalk.dim(i18n.t("chat.messages.aborted")) + "\n",
        );
      } else {
        process.stdout.write(
          "\n  " +
            chalk.red(
              i18n.t("chat.errors.requestFailed", { message: err.message }),
            ) +
            "\n",
        );
      }
      continue;
    }

    stopThinkingOnce();
    if (shouldStream) {
      clearVisibleInput();
      queuedInput = passiveInput.stop();
      if (!streamedText && response.text) {
        printAiMessage(response.text, context);
      } else if (streamedText && response.text && response.text !== streamedText) {
        process.stdout.write("\n");
        printAiMessage(response.text, context);
      }
    } else {
      clearVisibleInput();
      queuedInput = passiveInput.stop();
      printAiMessage(response.text, context);
    }
    process.stdout.write("\n");
  }
}
