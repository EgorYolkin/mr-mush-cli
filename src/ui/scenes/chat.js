import os from "node:os";
import fs from "node:fs/promises";
import path from "node:path";
import chalk from "chalk";
import { getProvider } from "../../providers/index.js";
import { createPassiveInputBuffer, promptInput } from "../input.js";
import { executeCommand } from "../../commands/index.js";
import { DOT_CHOICES } from "../symbols.js";
import { loadConfig, saveState } from "../../config/loader.js";
import {
  buildRepoMapAnswerForPrompt,
  isRepoIntelligencePrompt,
} from "../../intelligence/index.js";
import { createTaskActor, waitForTaskActor } from "../../orchestrator/index.js";
import { runProviderWithTools } from "../../tools/orchestrator.js";
import { createSession, recordMessage } from "../../history/session.js";
import { formatDuration, formatTokenCount } from "../../history/metrics.js";
import { buildMushCardFrame } from "../mush-card.js";
import { prepareInlineTerminalSurface } from "../components/terminal.js";
import { activeTheme, color } from "../components/theme.js";
import { frameWidth, fitText } from "../components/layout.js";
import {
  buildAiMessageFrame,
  buildUserMessageFrame,
  buildToolEventFrame,
  buildTerminalEventFrame,
  buildExpandableTerminalEventFrame,
  createTerminalEventMeta,
  stripToolMarkup,
} from "../components/frame.js";
import { formatPendingLine } from "../components/pending.js";

// ─── Scene-level helpers ──────────────────────────────────────────────────────

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
  return formatTokenCount(extractOutputTokens(usage));
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

function buildSplashFrame(context) {
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

  return buildMushCardFrame(context, [
    { text: `  ${dot}  ${provider}/${model}`, paint: muted },
    { text: `  ${dot}  ${level} effort`, paint: muted },
    { text: `  ${dot}  ${cwd}`, paint: muted },
    { text: ` ${dot}  v${appVersion}`, paint: muted },
  ]);
}

// ─── Messages outside the main frame ──────────────────────────────────────────

// ─── Print helpers — own process.stdout.write, call frame builders ────────────

function printUserMessage(text, context) {
  const frame = buildUserMessageFrame(text, context);
  process.stdout.write(frame.text);
  return frame.blockHeight;
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

function buildReplayAssistantMessage(entry, providerId) {
  if (entry.role !== "assistant") return null;
  if (entry.meta?.kind) return null;

  const payload = entry.assistantPayload ?? null;
  if (providerId === "deepseek" && payload) {
    return {
      role: "assistant",
      content: payload.content ?? entry.text ?? "",
      ...(payload.reasoning_content
        ? { reasoning_content: payload.reasoning_content }
        : {}),
      ...(payload.tool_calls?.length ? { tool_calls: payload.tool_calls } : {}),
    };
  }

  return {
    role: "assistant",
    content: entry.text ?? "",
  };
}

export function buildMessagesFromTranscript(
  promptStack,
  transcript,
  currentPrompt,
  providerId,
) {
  const messages = [];
  if (promptStack?.text) {
    messages.push({ role: "system", content: promptStack.text });
  }
  for (const entry of transcript) {
    if (entry.role === "user") {
      messages.push({ role: "user", content: entry.text });
      continue;
    }
    const assistantMessage = buildReplayAssistantMessage(entry, providerId);
    if (assistantMessage) {
      messages.push(assistantMessage);
    }
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
  return (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !path.isAbsolute(relativePath))
  );
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
    return (
      relativePath === pattern ||
      relativePath.startsWith(`${pattern}/`) ||
      resolvedPath.includes(`${path.sep}${pattern}${path.sep}`) ||
      resolvedPath.endsWith(`${path.sep}${pattern}`)
    );
  });
}

async function buildPromptWithFileMentions(text, context) {
  const mentions = extractFileMentions(text);
  if (mentions.length === 0) return text;

  const maxBytes =
    Math.max(1, context.config.tools?.files?.max_file_size_kb ?? 512) * 1024;
  const fileBlocks = [];

  for (const mention of mentions) {
    if (!isInsideCwd(mention, context.cwd)) continue;
    if (isDeniedFileMention(mention, context.cwd, context.config.tools?.files))
      continue;
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
    const visibleContent = truncated ? content.slice(0, maxBytes) : content;
    fileBlocks.push(
      [
        `File: ${mention}${truncated ? " (truncated)" : ""}`,
        "```",
        visibleContent,
        "```",
      ].join("\n"),
    );
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

function createDebugEventMeta(title = "debug") {
  return {
    kind: "tool_event",
    title,
  };
}

function formatOrchestratorDebugLine(
  snapshot,
  { providerId, routerProviderId },
) {
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
    const message =
      snapshot.context.error?.message ??
      String(snapshot.context.error ?? "unknown error");
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
  return [`${step}. ${lines[0]}`, ...lines.slice(1)].join("\n");
}

function summarizeRepoMapLayer(config, promptStack) {
  const enabled = config?.intelligence?.repo_map?.enabled ?? false;
  if (!enabled) {
    return "intelligence: repo-map disabled";
  }

  const repoLayer = promptStack?.layers?.find(
    (layer) => layer.id === "repo-map",
  );
  if (!repoLayer) {
    return "intelligence: repo-map layer missing";
  }

  const content = String(repoLayer.content ?? "").trim();
  if (!content) {
    return "intelligence: repo-map enabled but empty";
  }

  const mode =
    repoLayer.meta?.mode ?? config?.intelligence?.repo_map?.mode ?? "dense";
  const files = repoLayer.meta?.files ?? 0;
  const symbols = repoLayer.meta?.symbols ?? 0;
  const exportedSymbols = repoLayer.meta?.exportedSymbols ?? 0;
  const internalSymbols = repoLayer.meta?.internalSymbols ?? 0;
  const lines = content.split("\n");
  const fileLines = lines.filter(
    (line) =>
      line &&
      !line.startsWith("  ") &&
      line !== "Repository map:" &&
      line !== "Repository map context:" &&
      !line.startsWith("This is a generated") &&
      !line.startsWith("Use this map before") &&
      !line.startsWith("If the user asks") &&
      !line.startsWith("Only call filesystem"),
  );
  const previewFiles = fileLines.slice(0, 3).join(", ");
  const approxTokens = Math.ceil(content.length / 4);

  return [
    `intelligence: repo-map attached mode=${mode} tokens~=${approxTokens} files=${files || fileLines.length} symbols=${symbols} exported=${exportedSymbols} internal=${internalSymbols}`,
    previewFiles ? `intelligence: top files ${previewFiles}` : null,
  ]
    .filter(Boolean)
    .join("\n");
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
  let resetLiveRegionState = () => {};
  let renderedTranscriptEntries = 0;
  let splashFrame = null;
  let splashVisible = false;

  context.chatSessionOrchestrator = {
    errors: context.chatSessionOrchestrator?.errors ?? 0,
    maxErrors: context.chatSessionOrchestrator?.maxErrors ?? 3,
    openedAt: context.chatSessionOrchestrator?.openedAt ?? null,
    resetDelayMs: context.chatSessionOrchestrator?.resetDelayMs ?? 30_000,
  };

  function appendAssistantMessage(
    text,
    usage = null,
    meta = null,
    assistantPayload = null,
  ) {
    const normalizedText = text ?? "";
    if (!normalizedText.trim() && !assistantPayload) return;
    transcript.push({
      role: "assistant",
      text: normalizedText,
      meta,
      assistantPayload,
    });
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
        content: normalizedText,
        usage: usage ?? null,
        ...(assistantPayload ? { assistantPayload } : {}),
      }).catch(() => {});
    }
    if (!normalizedText.trim()) {
      renderedTranscriptEntries = transcript.length;
      return;
    }
    if (meta?.kind === "tool_event") {
      printToolEventMessage(meta.title ?? "tool", text, context);
      renderedTranscriptEntries = transcript.length;
      return;
    }
    if (meta?.kind === "terminal_event") {
      printExpandableTerminalEventMessage({ text, meta }, context);
      renderedTranscriptEntries = transcript.length;
      return;
    }
    printAiMessage(text, context);
    renderedTranscriptEntries = transcript.length;
  }

  function appendEventMessage(text, meta) {
    if (!text?.trim()) return;
    const lastEntry = transcript.at(-1);
    if (
      meta?.kind === "tool_event" &&
      meta?.title === "debug" &&
      lastEntry?.meta?.kind === "tool_event" &&
      lastEntry?.meta?.title === "debug"
    ) {
      lastEntry.text = `${lastEntry.text}\n\n${text}`;
      redrawScreen({ fullRefresh: true });
      return;
    }
    transcript.push({ role: "assistant", text, meta });
    if (meta?.kind === "terminal_event") {
      printExpandableTerminalEventMessage({ text, meta }, context);
      renderedTranscriptEntries = transcript.length;
      return;
    }
    if (meta?.kind === "tool_event") {
      printToolEventMessage(meta.title ?? "event", text, context);
      renderedTranscriptEntries = transcript.length;
      return;
    }
    printAiMessage(text, context);
    renderedTranscriptEntries = transcript.length;
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
    prepareInlineTerminalSurface();
    process.stdout.write("\n");
    splashFrame = buildSplashFrame(context);
    splashVisible = true;
    process.stdout.write(splashFrame.text);
  }

  function renderTranscriptEntry(entry) {
    if (entry.role === "user") {
      printUserMessage(entry.text, context);
    } else if (!entry.text?.trim()) {
      return;
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
    fullRefresh = true,
  } = {}) {
    if (fullRefresh) {
      process.stdout.write("\x1b[?25l\x1b[H\x1b[J");
      if (splashVisible) {
        process.stdout.write("\n");
        splashFrame = buildSplashFrame(context);
        process.stdout.write(splashFrame.text);
      }
      renderedTranscriptEntries = 0;
    }

    for (
      let index = renderedTranscriptEntries;
      index < transcript.length;
      index += 1
    ) {
      renderTranscriptEntry(transcript[index]);
    }
    renderedTranscriptEntries = transcript.length;

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

    if (fullRefresh) {
      process.stdout.write("\x1b[?25h");
    }
    resetLiveRegionState();
  }

  setupViewport();

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
            null,
            [...transcript]
              .filter((e) => e.role === "user")
              .map((e) => e.text)
              .reverse(),
            { cwd: context.cwd },
          )
        ).trim();
        context.currentSessionDisplayedTokens =
          context.currentSessionMetrics?.outputTokens ?? 0;
        queuedInput = "";
      } catch {
        break;
      }

      if (!text) {
        continue;
      }

      // Commands
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
              .map((m) => ({
                role: m.role,
                text: m.content,
                ...(m.assistantPayload
                  ? { assistantPayload: m.assistantPayload }
                  : {}),
              })),
          );
          redrawScreen({ fullRefresh: true });
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
        context.chatSessionOrchestrator.openedAt &&
        Date.now() - context.chatSessionOrchestrator.openedAt >=
          context.chatSessionOrchestrator.resetDelayMs
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
      const shouldStream = provider.source !== "cli";
      let streamedText = "";
      let inputVisible = false;
      let pendingFrameIndex = 0;
      let pendingAnimation = null;
      let streamRedrawTimer = null;
      let liveRegionCursorUpLines = 0;
      let liveRegionBlockHeight = 0;
      let activeBlockMode = "none";
      let expandableTerminalEntry = null;
      let expandKeyHandler = null;

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

      resetLiveRegionState = () => {
        liveRegionCursorUpLines = 0;
        liveRegionBlockHeight = 0;
        activeBlockMode = "none";
      };

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
        if (!entry?.meta?.canExpand) {
          disableTerminalExpansion();
          return;
        }
        if (expandKeyHandler) {
          if (expandableTerminalEntry?.meta) {
            expandableTerminalEntry.meta.canExpand = false;
          }
          expandableTerminalEntry = entry;
          return;
        }
        expandableTerminalEntry = entry;
        expandKeyHandler = (key) => {
          if (key === "\x03") {
            disableTerminalExpansion();
            abort.abort();
            return;
          }
          if (key !== "\x0f") return;
          if (!expandableTerminalEntry?.meta?.canExpand) return;
          expandableTerminalEntry.meta.expanded =
            !expandableTerminalEntry.meta.expanded;
          clearLiveRegion();
          redrawScreen({ fullRefresh: true });
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
            text: `${formatPendingLine(context, pendingFrameIndex)}\n\n`,
            blockHeight: 2,
            cursorUpLines: 2,
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
        }
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
          providerId,
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
              appendDebugMessage(
                "intelligence: answering directly from repo-map",
              );
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
              redrawScreen({ fullRefresh: true });
            }
          },
          onAssistantToolIntent: async ({ assistantText, assistantMessage }) => {
            stopPendingAnimation();
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
            appendAssistantMessage(
              visibleAssistantText,
              null,
              null,
              assistantMessage
                ? {
                    content: assistantMessage.content ?? "",
                    ...(assistantMessage.reasoning_content
                      ? {
                          reasoning_content:
                            assistantMessage.reasoning_content,
                        }
                      : {}),
                    ...(assistantMessage.tool_calls?.length
                      ? { tool_calls: assistantMessage.tool_calls }
                      : {}),
                  }
                : null,
            );
            streamedText = "";
          },
          onToolResult: async ({ toolCall, toolResult }) => {
            stopPendingAnimation();
            if (streamRedrawTimer) {
              clearTimeout(streamRedrawTimer);
              streamRedrawTimer = null;
            }
            clearLiveRegion();
            const meta = createTerminalEventMeta(toolCall, toolResult);
            if (meta?.text) {
              appendAssistantMessage(meta.text, null, meta);
              enableTerminalExpansion(transcript.at(-1));
            }
          },
        };
        if (!response && context.config.orchestrator?.enabled) {
          const routerProviderId =
            context.config.orchestrator?.router_provider ??
            context.runtimeOverrides.providerId ??
            context.config.activeProvider;
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
              openedAt: context.chatSessionOrchestrator.openedAt ?? Date.now(),
            };
            throw new Error(
              "Task orchestrator circuit is open. Please wait 30 seconds and retry.",
            );
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
          shouldStream &&
          (!response?.text || response.text.trim().length === 0) &&
          provider.source === "api"
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
                context.chatSessionOrchestrator.errors + 1 >=
                context.chatSessionOrchestrator.maxErrors
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
        redrawScreen({ fullRefresh: true });
      }
      flushStreamRender();
      if (shouldStream) {
        if (passiveInput) {
          queuedInput = passiveInput.stop();
          passiveInput = null;
          inputVisible = false;
        }
        const assistantText = response.text || streamedText;
        if (assistantText) {
          clearLiveRegion();
          appendAssistantMessage(
            assistantText,
            response.usage,
            null,
            response.assistantMessage ?? null,
          );
        }
      } else {
        clearLiveRegion();
        appendAssistantMessage(
          response.text,
          response.usage,
          null,
          response.assistantMessage ?? null,
        );
      }
      process.stdout.write("\n");
    }
  } finally {
    teardownViewport();
    resetLiveRegionState = () => {};
  }
}
