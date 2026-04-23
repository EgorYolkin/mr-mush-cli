import os from "node:os";
import fs from "node:fs/promises";
import path from "node:path";
import chalk from "chalk";
import { getProvider } from "../../providers/index.js";
import { createPassiveInputBuffer, promptInput } from "../input.js";
import { DOT_CHOICES, executeCommand } from "../../commands/index.js";
import { loadConfig, saveState } from "../../config/loader.js";
import { buildRepoMapAnswerForPrompt, isRepoIntelligencePrompt } from "../../intelligence/index.js";
import { createTaskActor, waitForTaskActor } from "../../orchestrator/index.js";
import { runProviderWithTools } from "../../tools/orchestrator.js";
import { createSession, recordMessage } from "../../history/session.js";
import { formatDuration, formatTokenCount } from "../../history/metrics.js";
import { printMushCard } from "../mush-card.js";

// ─── Layout ───────────────────────────────────────────────────────────────────

function activeTheme(context) {
  return context.ui?.theme ?? {};
}

function color(theme, name, fallback = chalk.white) {
  return theme.colors?.[name] ?? fallback;
}

function frameWidth() {
  const columns = process.stdout.columns || 96;
  return Math.max(6, Math.min(columns - 1, 92));
}

function wrapText(text, width, indent) {
  const rows = [];
  const maxWidth = Math.max(1, width);

  for (const rawLine of text.split("\n")) {
    const words = rawLine.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      rows.push("");
      continue;
    }

    let line = "";
    for (const word of words) {
      if (word.length > maxWidth) {
        if (line) {
          rows.push(line);
          line = "";
        }

        for (let start = 0; start < word.length; start += maxWidth) {
          const chunk = word.slice(start, start + maxWidth);
          if (chunk.length === maxWidth || start + maxWidth < word.length) {
            rows.push(`${indent}${chunk}`);
          } else {
            line = `${indent}${chunk}`;
          }
        }
        continue;
      }

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

function formatCwd(cwd) {
  const home = os.homedir();
  return cwd.startsWith(home) ? `~${cwd.slice(home.length)}` : cwd;
}

function formatFolder(cwd) {
  return path.basename(cwd) || cwd;
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

function extractOutputTokens(usage) {
  if (!usage) return 0;
  return (
    usage.output_tokens ??
    usage.completion_tokens ??
    usage.outputTokens ??
    usage.candidatesTokenCount ??
    usage.outputTokenCount ??
    0
  );
}

function extractInputTokens(usage) {
  if (!usage) return 0;
  return (
    usage.input_tokens ??
    usage.prompt_tokens ??
    usage.inputTokens ??
    usage.promptTokenCount ??
    usage.inputTokenCount ??
    0
  );
}

function formatUsage(usage) {
  return formatTokenCount(extractTotalTokens(usage));
}

function inputStatus(context, tokens, { animateSessionTokens = false } = {}) {
  const startedAt =
    context.currentSessionMeta?.createdAt ??
    context.currentSessionStartedAt ??
    null;
  const sessionDurationMs = startedAt
    ? Math.max(0, Date.now() - new Date(startedAt).getTime())
    : 0;
  const targetSessionTokens = context.currentSessionMetrics?.outputTokens ?? 0;
  const visibleSessionTokens = animateSessionTokens
    ? (context.currentSessionDisplayedTokens ?? targetSessionTokens)
    : targetSessionTokens;
  return {
    folder: formatFolder(context.cwd ?? process.cwd()),
    model: context.runtimeOverrides.model ?? context.config.activeModel,
    thinking:
      context.runtimeOverrides.thinkingLevel ??
      context.config.thinkingLevel ??
      "medium",
    tokens,
    messages: String(context.currentSessionMetrics?.messageCount ?? 0),
    sessionTokens: formatTokenCount(visibleSessionTokens),
    sessionTokensFrom: visibleSessionTokens,
    sessionTokensTarget: targetSessionTokens,
    formatSessionTokens: formatTokenCount,
    sessionTime: formatDuration(sessionDurationMs),
    template:
      context.runtimeOverrides.config?.ui?.statusbar_prompt ??
      context.config.ui?.statusbar_prompt,
  };
}

const PENDING_SUFFIXES = [".", "..", "...", ".."];

function formatPendingLine(context, frameIndex) {
  const theme = activeTheme(context);
  const muted = color(theme, "muted", chalk.dim);
  const marker = DOT_CHOICES[frameIndex % DOT_CHOICES.length] ?? "⬢";
  const suffix = PENDING_SUFFIXES[frameIndex % PENDING_SUFFIXES.length];
  return muted(`${marker} Mushing${suffix}`);
}

function splash(context) {
  const model = context.runtimeOverrides.model ?? context.config.activeModel;
  const level =
    context.runtimeOverrides.thinkingLevel ??
    context.config.thinkingLevel ??
    "medium";
  const provider =
    context.runtimeOverrides.providerId ?? context.config.activeProvider;
  const cwd = formatCwd(context.cwd ?? process.cwd());
  const theme = activeTheme(context);
  const dot =
    context.config.ui?.message_dot ?? theme.symbols?.messageDot ?? "⬢";
  const muted = color(theme, "muted", chalk.dim);
  const appVersion = context.appVersion ?? "–";

  printMushCard(context, [
    { text: `${dot}  ${provider}/${model} ( ${level} effort )`, paint: muted },
    { text: `${dot}  ${cwd}`, paint: muted },
    { text: `${dot}  v${appVersion}`, paint: muted },
  ]);
}

// ─── Messages — вне рамки ─────────────────────────────────────────────────────

function buildMessageLines(text, width) {
  const lines = [];

  for (const rawLine of text.split("\n")) {
    const fence = rawLine.match(/^```(\w+)?\s*$/);
    if (fence) continue;

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

function normalizeCompareText(text) {
  return (text ?? "").replace(/\s+/g, " ").trim();
}

function stripToolMarkup(text) {
  return (text ?? "")
    .replace(/```agents-tool[\s\S]*?```/g, "")
    .replace(/```agents-tool[\s\S]*$/g, "")
    .trimEnd();
}

function printUserMessage(text, context) {
  const frame = buildUserMessageFrame(text, context);
  process.stdout.write(frame.text);
  return frame.blockHeight;
}

function buildUserMessageFrame(text, context) {
  const theme = activeTheme(context);
  const symbol =
    context.config.ui?.message_dot ?? theme.symbols?.messageDot ?? "⬢";
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

function printAiMessage(text, context) {
  const frame = buildAiMessageFrame(text, context);
  process.stdout.write(frame.text);
  return frame.blockHeight;
}

function printToolEventMessage(title, text, context) {
  const frame = buildToolEventFrame(title, text, context);
  process.stdout.write(frame.text);
  return frame.blockHeight;
}

function printTerminalEventMessage(text, context) {
  const frame = buildTerminalEventFrame(text, context);
  process.stdout.write(frame.text);
  return frame.blockHeight;
}

function printExpandableTerminalEventMessage(entry, context) {
  const frame = buildExpandableTerminalEventFrame(entry, context);
  process.stdout.write(frame.text);
  return frame.blockHeight;
}

function buildAiMessageFrame(text, context) {
  const theme = activeTheme(context);
  const symbol =
    context.config.ui?.message_dot ?? theme.symbols?.messageDot ?? "⬢";
  const accent = color(theme, "accent", chalk.magenta);
  const name = theme.layout?.agentName ?? "mr. mush";
  const contentWidth = Math.max(1, (process.stdout.columns || 80) - 4);
  const bodyLines = buildMessageLines(text, contentWidth);
  const lines = [`${accent(`${symbol}\u00A0${name}`)}`];
  for (const line of bodyLines) {
    lines.push(`${accent("  ")}${chalk.white(line)}`);
  }
  return {
    text: `${lines.join("\n")}\n\n`,
    blockHeight: lines.length + 1,
    cursorUpLines: lines.length + 1,
  };
}

function buildToolEventFrame(title, text, context) {
  const theme = activeTheme(context);
  const symbol =
    context.config.ui?.message_dot ?? theme.symbols?.messageDot ?? "⬢";
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

function buildTerminalEventFrame(text, context) {
  const theme = activeTheme(context);
  const muted = color(theme, "muted", chalk.dim);
  const symbol =
    context.config.ui?.message_dot ?? theme.symbols?.messageDot ?? "⬢";
  const continuationPrefix = "  ";
  const contentWidth = Math.max(1, (process.stdout.columns || 80) - 4);
  const bodyLines = buildMessageLines(text, contentWidth);
  const lines = [muted(`${symbol} Terminal`)];
  for (let index = 0; index < bodyLines.length; index += 1) {
    lines.push(muted(`${continuationPrefix}${bodyLines[index]}`));
  }
  return {
    text: `${lines.join("\n")}\n\n`,
    blockHeight: lines.length + 1,
    cursorUpLines: lines.length + 1,
  };
}

function buildExpandableTerminalEventFrame(entry, context) {
  const text = entry.meta?.expanded ? entry.meta.fullText : entry.text;
  const frame = buildTerminalEventFrame(text, context);
  if (entry.meta?.canExpand) {
    const theme = activeTheme(context);
    const muted = color(theme, "muted", chalk.dim);
    const symbol =
      context.config.ui?.message_dot ?? theme.symbols?.messageDot ?? "⬢";
    const action = entry.meta.expanded ? "свернуть" : "развернуть";
    const hint = `\n${muted(`${symbol} Ctrl + O чтобы ${action} вывод`)}\n\n`;
    return {
      text: frame.text + hint,
      blockHeight: frame.blockHeight + 3,
      cursorUpLines: frame.cursorUpLines + 3,
    };
  }
  return frame;
}

function highlightCodeLine(line) {
  return line
    .replace(
      /\b(const|let|var|function|return|if|else|for|while|import|from|export|class|async|await|def|print|in|try|except)\b/g,
      (match) => chalk.hex("#c084fc")(match),
    )
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
      process.stdout.write(
        `${prefix}${chalk.dim("│ ")}${highlightCodeLine(rawLine)}\n`,
      );
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

function buildMessagesFromTranscript(promptStack, transcript, currentPrompt) {
  const messages = [];
  if (promptStack?.text) {
    messages.push({ role: "system", content: promptStack.text });
  }
  for (const entry of transcript) {
    messages.push({
      role: entry.role === "assistant" ? "assistant" : "user",
      content: entry.text,
    });
  }
  messages.push({ role: "user", content: currentPrompt });
  return messages;
}

function extractFileMentions(text) {
  const matches = text.matchAll(/(^|\s)@([^\s]+)/g);
  return [...new Set([...matches].map((match) => match[2]).filter(Boolean))];
}

function isInsideCwd(filePath, cwd) {
  const resolvedCwd = path.resolve(cwd);
  const resolvedPath = path.resolve(resolvedCwd, filePath);
  const relativePath = path.relative(resolvedCwd, resolvedPath);
  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

function isDeniedFileMention(filePath, cwd, config = {}) {
  const resolvedCwd = path.resolve(cwd);
  const resolvedPath = path.resolve(resolvedCwd, filePath);
  const relativePath = path.relative(resolvedCwd, resolvedPath);
  const deniedPatterns = config.denied_paths ?? [
    ".git",
    "node_modules",
    ".env",
    ".env.local",
    ".env.production",
  ];

  return deniedPatterns.some((pattern) => {
    if (!pattern) return false;
    return relativePath === pattern
      || relativePath.startsWith(`${pattern}/`)
      || resolvedPath.includes(`${path.sep}${pattern}${path.sep}`)
      || resolvedPath.endsWith(`${path.sep}${pattern}`);
  });
}

async function buildPromptWithFileMentions(text, context) {
  const mentions = extractFileMentions(text);
  if (mentions.length === 0) return text;

  const maxBytes = Math.max(1, context.config.tools?.files?.max_file_size_kb ?? 512) * 1024;
  const fileBlocks = [];

  for (const mention of mentions) {
    if (!isInsideCwd(mention, context.cwd)) continue;
    if (isDeniedFileMention(mention, context.cwd, context.config.tools?.files)) continue;
    const resolvedPath = path.resolve(context.cwd, mention);
    let content;
    try {
      const stat = await fs.stat(resolvedPath);
      if (!stat.isFile()) continue;
      content = await fs.readFile(resolvedPath, "utf8");
    } catch {
      continue;
    }

    const truncated = Buffer.byteLength(content, "utf8") > maxBytes;
    const visibleContent = truncated
      ? content.slice(0, maxBytes)
      : content;
    fileBlocks.push([
      `File: ${mention}${truncated ? " (truncated)" : ""}`,
      "```",
      visibleContent,
      "```",
    ].join("\n"));
  }

  if (fileBlocks.length === 0) return text;

  return [
    text,
    "",
    "Referenced files from @mentions:",
    "",
    fileBlocks.join("\n\n"),
  ].join("\n");
}

function formatToolCallMessage(toolCall) {
  if (!toolCall) return "";
  if (toolCall.name === "bash") {
    return `wants to run\n${toolCall.args.cmd}`;
  }
  if (toolCall.name === "write_file") {
    return `wants to write a file\n${toolCall.args.path}`;
  }
  return `wants to use ${toolCall.name}`;
}

function formatToolResultMessage(toolCall, toolResult) {
  if (!toolCall || !toolResult) return "";
  if (toolCall.name === "bash") {
    const parts = [toolCall.args.cmd];
    if (toolResult.stdout?.trim()) {
      parts.push(toolResult.stdout.trimEnd());
    }
    if (toolResult.stderr?.trim()) {
      parts.push(toolResult.stderr.trimEnd());
    }
    if (!toolResult.stdout?.trim() && !toolResult.stderr?.trim()) {
      parts.push(
        toolResult.blocked
          ? "command blocked"
          : `exit code: ${toolResult.exit_code ?? "–"}`,
      );
    }
    return parts.join("\n");
  }

  if (toolCall.name === "write_file") {
    const parts = [
      `${toolCall.args.path}`,
      toolResult.error?.trim()
        ? toolResult.error.trim()
        : `written: ${toolResult.written ?? 0} bytes`,
    ];
    return parts.join("\n");
  }

  return "";
}

function createTerminalEventMeta(toolCall, toolResult) {
  if (!toolCall) return "";

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

    const headLines = [
      `wants to run ${toolCall.args.cmd}`,
      "",
      `❯ ${toolCall.args.cmd}`,
    ];
    const fullLines = [...headLines, "", ...outputLines];
    const visibleOutputLines = outputLines.slice(0, 10);
    const collapsedLines = [...headLines, "", ...visibleOutputLines];
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
      `wants to write ${toolCall.args.path}`,
      "",
      `❯ write_file ${toolCall.args.path}`,
    ];
    if (toolResult?.error?.trim()) {
      lines.push("", ...toolResult.error.trim().split("\n").map((line) => `  ${line}`));
    } else {
      lines.push("", `  written: ${toolResult?.written ?? 0} bytes`);
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

function createDebugEventMeta(title = "debug") {
  return {
    kind: "tool_event",
    title,
  };
}

function formatOrchestratorDebugLine(snapshot, { providerId, routerProviderId }) {
  const state = String(snapshot.value);

  if (state === "routing") {
    return `orchestrator: routing via ${routerProviderId}`;
  }

  if (state === "dispatching") {
    return `orchestrator: domain=${snapshot.context.domain ?? "general"} action=${snapshot.context.action ?? "respond"} confidence=${snapshot.context.confidence ?? 0}`;
  }

  if (state === "executing") {
    return `worker: domain=${snapshot.context.domain ?? "general"} provider=${providerId}`;
  }

  if (state === "done") {
    return `orchestrator: done domain=${snapshot.context.domain ?? "general"}`;
  }

  if (state === "error") {
    const message = snapshot.context.error?.message ?? String(snapshot.context.error ?? "unknown error");
    return `orchestrator: error ${message}`;
  }

  if (state === "circuit_open") {
    return `orchestrator: circuit_open errors=${snapshot.context.errors}/${snapshot.context.maxErrors}`;
  }

  return `orchestrator: state=${state}`;
}

function formatDebugBlock(message) {
  return String(message ?? "")
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .join("\n");
}

function formatNumberedDebugBlock(step, message) {
  const lines = formatDebugBlock(message).split("\n");
  if (lines.length === 0) return `${step}.`;
  return [
    `${step}. ${lines[0]}`,
    ...lines.slice(1),
  ].join("\n");
}

function summarizeRepoMapLayer(config, promptStack) {
  const enabled = config?.intelligence?.repo_map?.enabled ?? false;
  if (!enabled) {
    return "intelligence: repo-map disabled";
  }

  const repoLayer = promptStack?.layers?.find((layer) => layer.id === "repo-map");
  if (!repoLayer) {
    return "intelligence: repo-map layer missing";
  }

  const content = String(repoLayer.content ?? "").trim();
  if (!content) {
    return "intelligence: repo-map enabled but empty";
  }

  const mode = repoLayer.meta?.mode ?? config?.intelligence?.repo_map?.mode ?? "dense";
  const files = repoLayer.meta?.files ?? 0;
  const symbols = repoLayer.meta?.symbols ?? 0;
  const exportedSymbols = repoLayer.meta?.exportedSymbols ?? 0;
  const internalSymbols = repoLayer.meta?.internalSymbols ?? 0;
  const lines = content.split("\n");
  const fileLines = lines.filter((line) => (
    line
    && !line.startsWith("  ")
    && line !== "Repository map:"
    && line !== "Repository map context:"
    && !line.startsWith("This is a generated")
    && !line.startsWith("Use this map before")
    && !line.startsWith("If the user asks")
    && !line.startsWith("Only call filesystem")
  ));
  const previewFiles = fileLines.slice(0, 3).join(", ");
  const approxTokens = Math.ceil(content.length / 4);

  return [
    `intelligence: repo-map attached mode=${mode} tokens~=${approxTokens} files=${files || fileLines.length} symbols=${symbols} exported=${exportedSymbols} internal=${internalSymbols}`,
    previewFiles ? `intelligence: top files ${previewFiles}` : null,
  ].filter(Boolean).join("\n");
}

function getRepoMapLayer(promptStack) {
  return promptStack?.layers?.find((layer) => layer.id === "repo-map") ?? null;
}

// ─── Main loop ────────────────────────────────────────────────────────────────

export async function runChatScreen(context) {
  const { i18n } = context;
  const transcript = [];
  let queuedInput = "";
  let lastTokens = "–";
  let passiveInput = null;
  let resizeHandler = null;
  let debugStepCounter = 0;

  context.chatSessionOrchestrator = {
    errors: context.chatSessionOrchestrator?.errors ?? 0,
    maxErrors: context.chatSessionOrchestrator?.maxErrors ?? 3,
    openedAt: context.chatSessionOrchestrator?.openedAt ?? null,
    resetDelayMs: context.chatSessionOrchestrator?.resetDelayMs ?? 30_000,
  };

  function appendAssistantMessage(text, usage = null, meta = null) {
    if (!text?.trim()) return;
    transcript.push({ role: "assistant", text, meta });
    context.currentSessionMetrics = {
      ...(context.currentSessionMetrics ?? {
        messageCount: 0,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
      }),
      messageCount: (context.currentSessionMetrics?.messageCount ?? 0) + 1,
      inputTokens:
        (context.currentSessionMetrics?.inputTokens ?? 0) +
        extractInputTokens(usage),
      outputTokens:
        (context.currentSessionMetrics?.outputTokens ?? 0) +
        extractOutputTokens(usage),
      totalTokens:
        (context.currentSessionMetrics?.totalTokens ?? 0) +
        (extractTotalTokens(usage) ?? 0),
    };
    if (currentSession) {
      recordMessage(historyDir, currentSession.id, {
        role: "assistant",
        content: text,
        usage: usage ?? null,
      }).catch(() => {});
    }
    if (meta?.kind === "tool_event") {
      printToolEventMessage(meta.title ?? "tool", text, context);
      return;
    }
    if (meta?.kind === "terminal_event") {
      printExpandableTerminalEventMessage({ text, meta }, context);
      return;
    }
    printAiMessage(text, context);
  }

  function appendEventMessage(text, meta) {
    if (!text?.trim()) return;
    const lastEntry = transcript.at(-1);
    if (
      meta?.kind === "tool_event"
      && meta?.title === "debug"
      && lastEntry?.meta?.kind === "tool_event"
      && lastEntry?.meta?.title === "debug"
    ) {
      lastEntry.text = `${lastEntry.text}\n\n${text}`;
      redrawScreen();
      return;
    }
    transcript.push({ role: "assistant", text, meta });
    if (meta?.kind === "terminal_event") {
      printExpandableTerminalEventMessage({ text, meta }, context);
      return;
    }
    if (meta?.kind === "tool_event") {
      printToolEventMessage(meta.title ?? "event", text, context);
      return;
    }
    printAiMessage(text, context);
  }

  function appendDebugMessage(text) {
    debugStepCounter += 1;
    appendEventMessage(
      formatNumberedDebugBlock(debugStepCounter, text),
      createDebugEventMeta("debug"),
    );
  }

  // Create a new history session
  const historyDir = context.config.paths.historyDir;
  const providerId =
    context.runtimeOverrides.providerId ?? context.config.activeProvider;
  const model = context.runtimeOverrides.model ?? context.config.activeModel;
  let currentSession = null;
  try {
    currentSession = await createSession(historyDir, {
      provider: providerId,
      model,
    });
    context.currentSession = currentSession;
    context.currentSessionMeta = {
      id: currentSession.id,
      createdAt: new Date().toISOString(),
      provider: providerId,
      model,
      messageCount: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
    };
    context.currentSessionStartedAt = context.currentSessionMeta.createdAt;
    context.currentSessionMetrics = {
      messageCount: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
    };
    context.currentSessionDisplayedTokens = 0;
  } catch {
    // history unavailable — continue without persistence
  }

  function teardownViewport() {
    if (resizeHandler) {
      process.stdout.removeListener("resize", resizeHandler);
      resizeHandler = null;
    }
  }

  function setupViewport() {
    process.stdout.write("\x1b[H\x1b[J");
  }

  function renderTranscriptEntry(entry) {
    if (entry.role === "user") {
      printUserMessage(entry.text, context);
    } else if (entry.meta?.kind === "terminal_event") {
      printExpandableTerminalEventMessage(entry, context);
    } else if (entry.meta?.kind === "tool_event") {
      printToolEventMessage(entry.meta.title ?? "tool", entry.text, context);
    } else {
      printAiMessage(entry.text, context);
    }
  }

  function redrawScreen({
    pendingLine = "",
    streamingText = "",
    renderInput = null,
  } = {}) {
    process.stdout.write("\x1b[?25l\x1b[H\x1b[J");
    process.stdout.write("\n");
    splash(context);

    for (const entry of transcript) {
      renderTranscriptEntry(entry);
    }

    if (pendingLine) {
      process.stdout.write(`${pendingLine}\n`);
    }

    if (streamingText) {
      printAiMessage(streamingText, context);
      process.stdout.write("\n");
    }

    if (renderInput) {
      renderInput();
    }

    process.stdout.write("\x1b[?25h");
  }

  setupViewport();
  redrawScreen();

  try {
    while (true) {
      const providerId =
        context.runtimeOverrides.providerId ?? context.config.activeProvider;
      const model =
        context.runtimeOverrides.model ?? context.config.activeModel;
      const provider = getProvider(providerId, i18n);

      let text;
      try {
        text = (
          await promptInput(
            i18n,
            activeTheme(context),
            queuedInput,
            inputStatus(context, lastTokens, { animateSessionTokens: true }),
            (renderInput) => redrawScreen({ renderInput }),
            [...transcript]
              .filter((e) => e.role === "user")
              .map((e) => e.text)
              .reverse(),
            { cwd: context.cwd },
          )
        ).trim();
        context.currentSessionDisplayedTokens =
          context.currentSessionMetrics?.totalTokens ?? 0;
        queuedInput = "";
      } catch {
        break;
      }

      if (!text) {
        continue;
      }

      // Команды
      if (text.startsWith("/")) {
        transcript.push({ role: "user", text });
        context.currentSessionMetrics = {
          ...(context.currentSessionMetrics ?? {
            messageCount: 0,
            inputTokens: 0,
            outputTokens: 0,
            totalTokens: 0,
          }),
          messageCount: (context.currentSessionMetrics?.messageCount ?? 0) + 1,
          inputTokens: context.currentSessionMetrics?.inputTokens ?? 0,
          outputTokens: context.currentSessionMetrics?.outputTokens ?? 0,
          totalTokens: context.currentSessionMetrics?.totalTokens ?? 0,
        };
        if (currentSession) {
          recordMessage(historyDir, currentSession.id, {
            role: "user",
            content: text,
          }).catch(() => {});
        }
        redrawScreen();
        const commandResult = await executeCommand(text, context);
        context.config = await loadConfig({
          cwd: context.cwd,
          runtimeOverrides: context.runtimeOverrides,
        });
        if (context.resumedSession) {
          const resumed = context.resumedSession;
          context.resumedSession = null;
          currentSession = { id: resumed.id, filePath: resumed.filePath };
          context.currentSession = currentSession;
          context.currentSessionMeta = resumed.meta ?? null;
          context.currentSessionStartedAt = resumed.meta?.createdAt ?? null;
          context.currentSessionMetrics = {
            messageCount: resumed.meta?.messageCount ?? 0,
            inputTokens: resumed.meta?.inputTokens ?? 0,
            outputTokens: resumed.meta?.outputTokens ?? 0,
            totalTokens: resumed.meta?.totalTokens ?? 0,
          };
          context.currentSessionDisplayedTokens =
            resumed.meta?.outputTokens ?? 0;
          transcript.splice(
            0,
            transcript.length,
            ...resumed.messages
              .filter((m) => m.role === "user" || m.role === "assistant")
              .map((m) => ({ role: m.role, text: m.content })),
          );
          redrawScreen();
        } else {
          if (commandResult?.rendered) {
            continue;
          }
          if (commandResult?.message) {
            transcript.push({ role: "assistant", text: commandResult.message });
            context.currentSessionMetrics = {
              ...(context.currentSessionMetrics ?? {
                messageCount: 0,
                inputTokens: 0,
                outputTokens: 0,
                totalTokens: 0,
              }),
              messageCount:
                (context.currentSessionMetrics?.messageCount ?? 0) + 1,
              inputTokens: context.currentSessionMetrics?.inputTokens ?? 0,
              outputTokens: context.currentSessionMetrics?.outputTokens ?? 0,
              totalTokens: context.currentSessionMetrics?.totalTokens ?? 0,
            };
            if (currentSession) {
              recordMessage(historyDir, currentSession.id, {
                role: "assistant",
                content: commandResult.message,
              }).catch(() => {});
            }
          }
          redrawScreen();
        }
        continue;
      }

      context.config = await loadConfig({
        cwd: context.cwd,
        runtimeOverrides: context.runtimeOverrides,
      });

      if (
        context.chatSessionOrchestrator.openedAt
        && Date.now() - context.chatSessionOrchestrator.openedAt
          >= context.chatSessionOrchestrator.resetDelayMs
      ) {
        context.chatSessionOrchestrator = {
          ...context.chatSessionOrchestrator,
          errors: 0,
          openedAt: null,
        };
      }

      transcript.push({ role: "user", text });
      debugStepCounter = 0;
      context.currentSessionMetrics = {
        ...(context.currentSessionMetrics ?? {
          messageCount: 0,
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
        }),
        messageCount: (context.currentSessionMetrics?.messageCount ?? 0) + 1,
        inputTokens: context.currentSessionMetrics?.inputTokens ?? 0,
        outputTokens: context.currentSessionMetrics?.outputTokens ?? 0,
        totalTokens: context.currentSessionMetrics?.totalTokens ?? 0,
      };
      if (currentSession) {
        recordMessage(historyDir, currentSession.id, {
          role: "user",
          content: text,
        }).catch(() => {});
      }
      redrawScreen();
      const abort = new AbortController();
      const stopThinking = () => {};
      const shouldStream = provider.source !== "cli";
      let streamedText = "";
      let hasStoppedThinking = false;
      let inputVisible = false;
      let pendingFrameIndex = 0;
      let pendingAnimation = null;
      let streamRedrawTimer = null;
      let liveRegionCursorUpLines = 0;
      let liveRegionBlockHeight = 0;
      let activeBlockMode = "none";
      let expandableTerminalEntry = null;
      let expandKeyHandler = null;

      function stopThinkingOnce() {
        if (hasStoppedThinking) return;
        stopThinking();
        hasStoppedThinking = true;
      }

      function clearVisibleInput() {
        if (!inputVisible) return;
        queuedInput = passiveInput.getBuffer();
        inputVisible = false;
      }

      function clearLiveRegion() {
        let out = "";
        if (liveRegionCursorUpLines > 0) {
          out += `\x1b[${liveRegionCursorUpLines}A`;
        }
        if (liveRegionBlockHeight > 0) {
          out += "\r\x1b[J";
        }
        if (out) {
          process.stdout.write(out);
        }
        liveRegionCursorUpLines = 0;
        liveRegionBlockHeight = 0;
        activeBlockMode = "none";
      }

      function disableTerminalExpansion() {
        if (!expandKeyHandler) return false;
        process.stdin.removeListener("data", expandKeyHandler);
        if (process.stdin.isTTY) {
          process.stdin.setRawMode(false);
        }
        process.stdin.pause();
        expandKeyHandler = null;
        if (expandableTerminalEntry?.meta) {
          expandableTerminalEntry.meta.canExpand = false;
        }
        expandableTerminalEntry = null;
        return true;
      }

      function enableTerminalExpansion(entry) {
        disableTerminalExpansion();
        if (!entry?.meta?.canExpand) return;
        expandableTerminalEntry = entry;
        expandKeyHandler = (key) => {
          if (key === "\x03") {
            disableTerminalExpansion();
            abort.abort();
            return;
          }
          if (key !== "\x0f") return;
          if (!expandableTerminalEntry?.meta?.canExpand) return;
          expandableTerminalEntry.meta.expanded = !expandableTerminalEntry.meta.expanded;
          clearLiveRegion();
          redrawScreen();
        };
        if (process.stdin.isTTY) {
          process.stdin.setRawMode(true);
        }
        process.stdin.resume();
        process.stdin.setEncoding("utf8");
        process.stdin.on("data", expandKeyHandler);
      }

      function renderLiveRegion(activeFrame = null, mode = "none") {
        const inputFrame = passiveInput ? passiveInput.getFrame() : null;
        let out = "";
        if (liveRegionCursorUpLines > 0) {
          out += `\x1b[${liveRegionCursorUpLines}A`;
        }
        if (liveRegionBlockHeight > 0) {
          out += "\r\x1b[J";
        }
        out += `${activeFrame?.text ?? ""}${inputFrame?.text ?? ""}`;
        if (out) {
          process.stdout.write(out);
        }
        liveRegionBlockHeight =
          (activeFrame?.blockHeight ?? 0) + (inputFrame?.blockHeight ?? 0);
        liveRegionCursorUpLines = inputFrame
          ? inputFrame.cursorUpLines + (activeFrame?.blockHeight ?? 0)
          : (activeFrame?.cursorUpLines ?? 0);
        inputVisible = Boolean(passiveInput);
        activeBlockMode = mode;
      }

      function renderPendingState() {
        renderLiveRegion(
          {
            text: `${formatPendingLine(context, pendingFrameIndex)}\n`,
            blockHeight: 1,
            cursorUpLines: 1,
          },
          "pending",
        );
      }

      function startPendingAnimation() {
        if (pendingAnimation) return;
        renderPendingState();
        pendingAnimation = setInterval(() => {
          pendingFrameIndex += 1;
          renderPendingState();
        }, 220);
      }

      function stopPendingAnimation() {
        if (!pendingAnimation) return;
        clearInterval(pendingAnimation);
        pendingAnimation = null;
      }

      function renderStreamingState() {
        renderLiveRegion(buildAiMessageFrame(streamedText, context), "stream");
      }

      function scheduleStreamRender() {
        if (streamRedrawTimer) return;
        streamRedrawTimer = setTimeout(() => {
          streamRedrawTimer = null;
          renderStreamingState();
        }, 33);
      }

      function flushStreamRender() {
        if (streamRedrawTimer) {
          clearTimeout(streamRedrawTimer);
          streamRedrawTimer = null;
        }
        if (streamedText) {
          renderStreamingState();
        }
      }

      resizeHandler = () => {
        if (shouldStream && activeBlockMode === "stream" && streamedText) {
          renderStreamingState();
          return;
        }
        if (activeBlockMode === "pending") {
          renderPendingState();
          return;
        }
        redrawScreen();
      };

      let response;
      try {
        passiveInput = createPassiveInputBuffer(i18n, activeTheme(context), {
          onEscape: () => abort.abort(),
          status: inputStatus(context, lastTokens),
          autoResize: false,
          externalRender: true,
          onChange: () => {
            if (activeBlockMode === "stream" && streamedText) {
              renderStreamingState();
              return;
            }
            if (activeBlockMode === "pending") {
              renderPendingState();
            }
          },
        });
        inputVisible = true;
        process.stdout.on("resize", resizeHandler);
        startPendingAnimation();
        const promptForModel = await buildPromptWithFileMentions(text, context);
        const messages = buildMessagesFromTranscript(
          context.config.promptStack,
          transcript,
          promptForModel,
        );
        const repoMapLayer = getRepoMapLayer(context.config.promptStack);
        if (context.runtimeOverrides.debug) {
          stopPendingAnimation();
          clearLiveRegion();
          appendDebugMessage(
            summarizeRepoMapLayer(context.config, context.config.promptStack),
          );
        }
        let answeredFromRepoMap = false;
        if (repoMapLayer && isRepoIntelligencePrompt(text)) {
          const directRepoMapAnswer = await buildRepoMapAnswerForPrompt(
            context.cwd,
            repoMapLayer.content,
            text,
          );
          if (directRepoMapAnswer) {
            answeredFromRepoMap = true;
            response = {
              text: directRepoMapAnswer,
              usage: null,
            };
            if (context.runtimeOverrides.debug) {
              stopPendingAnimation();
              clearLiveRegion();
              appendDebugMessage("intelligence: answering directly from repo-map");
              appendDebugMessage(
                `response: chars=${response.text.length} usage=no stream=off source=repo-map`,
              );
            }
          }
        }
        const providerCall = {
          provider,
          config: context.config,
          prompt: promptForModel,
          messages,
          runtimeOverrides: context.runtimeOverrides,
          signal: abort.signal,
          context,
          onToken: shouldStream
            ? (token) => {
                stopPendingAnimation();
                stopThinkingOnce();
                streamedText += token;
                scheduleStreamRender();
              }
            : null,
          beforeApproval: () => {
            stopPendingAnimation();
            if (passiveInput) {
              clearVisibleInput();
              queuedInput = passiveInput.stop();
              passiveInput = null;
            }
            clearLiveRegion();
          },
          afterApproval: () => {
            startPendingAnimation();
          },
          beforeToolCall: () => {
            if (disableTerminalExpansion()) {
              redrawScreen();
            }
          },
          onAssistantToolIntent: async ({ assistantText }) => {
            stopPendingAnimation();
            stopThinkingOnce();
            if (streamRedrawTimer) {
              clearTimeout(streamRedrawTimer);
              streamRedrawTimer = null;
            }
            clearLiveRegion();
            if (passiveInput) {
              queuedInput = passiveInput.stop();
              passiveInput = null;
              inputVisible = false;
            }

            const visibleAssistantText =
              stripToolMarkup(streamedText).trim().length > 0
                ? stripToolMarkup(streamedText)
                : stripToolMarkup(assistantText);
            if (visibleAssistantText?.trim()) {
              appendAssistantMessage(visibleAssistantText);
            }
            streamedText = "";
          },
          onToolResult: async ({ toolCall, toolResult }) => {
            const meta = createTerminalEventMeta(toolCall, toolResult);
            if (meta?.text) {
              appendAssistantMessage(meta.text, null, meta);
              enableTerminalExpansion(transcript.at(-1));
            }
          },
        };
        if (!response && context.config.orchestrator?.enabled) {
          const routerProviderId =
            context.config.orchestrator?.router_provider
            ?? context.runtimeOverrides.providerId
            ?? context.config.activeProvider;
          const routerProvider = getProvider(routerProviderId, i18n);
          const debugEnabled = Boolean(context.runtimeOverrides.debug);
          const actor = createTaskActor({
            prompt: promptForModel,
            provider,
            routerProvider,
            config: context.config,
            runtimeOverrides: context.runtimeOverrides,
            signal: abort.signal,
            context,
            errors: context.chatSessionOrchestrator.errors,
            maxErrors: context.chatSessionOrchestrator.maxErrors,
            hooks: {
              onToken: providerCall.onToken,
              beforeApproval: providerCall.beforeApproval,
              afterApproval: providerCall.afterApproval,
              beforeToolCall: providerCall.beforeToolCall,
              onAssistantToolIntent: providerCall.onAssistantToolIntent,
              onToolResult: providerCall.onToolResult,
              onDebugEvent: debugEnabled
                ? (message) => {
                    stopPendingAnimation();
                    clearLiveRegion();
                    appendDebugMessage(message);
                  }
                : null,
            },
          });
          let lastDebugState = null;
          let actorSubscription = null;
          if (debugEnabled) {
            actorSubscription = actor.subscribe((snapshot) => {
              const nextState = String(snapshot.value);
              if (nextState === lastDebugState || nextState === "idle") return;
              lastDebugState = nextState;

              stopPendingAnimation();
              clearLiveRegion();
              appendDebugMessage(
                formatOrchestratorDebugLine(snapshot, {
                  providerId,
                  routerProviderId,
                }),
              );
            });
          }
          actor.start();
          actor.send({ type: "SUBMIT", prompt: promptForModel });
          const snapshot = await waitForTaskActor(actor);
          actorSubscription?.unsubscribe();
          actor.stop();

          if (snapshot.matches("circuit_open")) {
            context.chatSessionOrchestrator = {
              ...context.chatSessionOrchestrator,
              errors: context.chatSessionOrchestrator.maxErrors,
              openedAt:
                context.chatSessionOrchestrator.openedAt ?? Date.now(),
            };
            throw new Error("Task orchestrator circuit is open. Please wait 30 seconds and retry.");
          }

          context.chatSessionOrchestrator = {
            ...context.chatSessionOrchestrator,
            errors: 0,
            openedAt: null,
          };
          response = snapshot.output?.result ?? snapshot.context.result;
        } else if (!response) {
          if (context.runtimeOverrides.debug) {
            stopPendingAnimation();
            clearLiveRegion();
            appendDebugMessage(
              `orchestrator: disabled, using direct provider=${providerId}`,
            );
          }
          response = await runProviderWithTools(providerCall);
        }
        if (context.runtimeOverrides.debug && !answeredFromRepoMap) {
          stopPendingAnimation();
          clearLiveRegion();
          appendDebugMessage(
            `response: chars=${response?.text?.length ?? 0} usage=${response?.usage ? "yes" : "no"} stream=${shouldStream ? "on" : "off"}`,
          );
        }
        if (
          shouldStream
          && (!response?.text || response.text.trim().length === 0)
          && provider.source === "api"
        ) {
          if (context.runtimeOverrides.debug) {
            stopPendingAnimation();
            clearLiveRegion();
            appendDebugMessage(
              "response: empty after streaming, retrying once without stream",
            );
          }
          response = await runProviderWithTools({
            ...providerCall,
            onToken: null,
          });
          if (context.runtimeOverrides.debug) {
            stopPendingAnimation();
            clearLiveRegion();
            appendDebugMessage(
              `response: retry chars=${response?.text?.length ?? 0} usage=${response?.usage ? "yes" : "no"} stream=off`,
            );
          }
        }
        lastTokens = formatUsage(response.usage);
        await saveState(
          {
            ...context.config.state,
            schemaVersion: context.config.schema_version,
            lastUsedProvider: providerId,
            lastUsedModel: model,
            lastUsedProfile:
              context.runtimeOverrides.profile ?? context.config.activeProfile,
            lastPromptAt: new Date().toISOString(),
          },
          context.config.paths,
        );
      } catch (err) {
        stopPendingAnimation();
        if (streamRedrawTimer) {
          clearTimeout(streamRedrawTimer);
          streamRedrawTimer = null;
        }
        disableTerminalExpansion();
        if (resizeHandler) {
          process.stdout.removeListener("resize", resizeHandler);
          resizeHandler = null;
        }
        stopThinkingOnce();
        if (passiveInput) {
          queuedInput = passiveInput.stop();
          passiveInput = null;
          inputVisible = false;
        }
        clearLiveRegion();
        if (abort.signal.aborted) {
          process.stdout.write(
            "\r\x1b[J\n  " + chalk.dim(i18n.t("chat.messages.aborted")) + "\n",
          );
        } else {
          if (context.config.orchestrator?.enabled) {
            context.chatSessionOrchestrator = {
              ...context.chatSessionOrchestrator,
              errors: Math.min(
                context.chatSessionOrchestrator.maxErrors,
                context.chatSessionOrchestrator.errors + 1,
              ),
              openedAt:
                context.chatSessionOrchestrator.errors + 1
                  >= context.chatSessionOrchestrator.maxErrors
                  ? (context.chatSessionOrchestrator.openedAt ?? Date.now())
                  : context.chatSessionOrchestrator.openedAt,
            };
          }
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

      if (resizeHandler) {
        process.stdout.removeListener("resize", resizeHandler);
        resizeHandler = null;
      }
      stopPendingAnimation();
      if (disableTerminalExpansion()) {
        redrawScreen();
      }
      flushStreamRender();
      stopThinkingOnce();
      if (shouldStream) {
        if (passiveInput) {
          queuedInput = passiveInput.stop();
          passiveInput = null;
          inputVisible = false;
        }
        const assistantText = response.text || streamedText;
        if (assistantText) {
          clearLiveRegion();
          appendAssistantMessage(assistantText, response.usage);
        }
      } else {
        clearLiveRegion();
        appendAssistantMessage(response.text, response.usage);
      }
      process.stdout.write("\n");
    }
  } finally {
    teardownViewport();
  }
}
