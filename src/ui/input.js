import chalk from "chalk";
import fs from "node:fs/promises";
import path from "node:path";
import { getSuggestions, getUsageHint } from "../commands/index.js";
import { frameWidth, fitText } from "./components/layout.js";

const FILE_SUGGESTION_LIMIT = 50;
const FILE_WALK_SKIP = new Set([
  ".git",
  ".mrmush",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".next",
  ".turbo",
]);

function createRenderState() {
  return { cursorUpLines: 0, blockHeight: 0, totalRenderedLines: 0 };
}

function resetRenderState(state) {
  if (!state) return;
  state.cursorUpLines = 0;
  state.blockHeight = 0;
  state.totalRenderedLines = 0;
}

function clearRenderedState(state) {
  // Use the actual number of rendered terminal lines for cleanup.
  const linesToGoUp = state?.cursorUpLines ?? 0;
  if (linesToGoUp > 0) {
    process.stdout.write(`\x1b[${linesToGoUp}A`);
  }
  process.stdout.write("\r\x1b[J");
}

function getCursorLocation(buffer, cursorIndex) {
  const lines = buffer.split("\n");
  let offset = 0;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    const lineEnd = offset + line.length;
    if (cursorIndex <= lineEnd) {
      return { lineIndex, column: cursorIndex - offset };
    }
    offset = lineEnd + 1;
  }

  const lastLine = lines[lines.length - 1] ?? "";
  return { lineIndex: lines.length - 1, column: lastLine.length };
}

function getLineStartIndex(buffer, targetLineIndex) {
  const lines = buffer.split("\n");
  let offset = 0;
  for (let lineIndex = 0; lineIndex < Math.min(targetLineIndex, lines.length); lineIndex += 1) {
    offset += lines[lineIndex].length + 1;
  }
  return offset;
}

function moveCursorVertical(buffer, cursorIndex, direction) {
  const lines = buffer.split("\n");
  const { lineIndex, column } = getCursorLocation(buffer, cursorIndex);
  const nextLineIndex = lineIndex + direction;
  if (nextLineIndex < 0 || nextLineIndex >= lines.length) {
    return { moved: false, cursorIndex };
  }

  const nextLine = lines[nextLineIndex] ?? "";
  const nextColumn = Math.min(column, nextLine.length);
  return {
    moved: true,
    cursorIndex: getLineStartIndex(buffer, nextLineIndex) + nextColumn,
  };
}

function insertAt(buffer, cursorIndex, text) {
  return buffer.slice(0, cursorIndex) + text + buffer.slice(cursorIndex);
}

function deleteRange(buffer, start, end) {
  return buffer.slice(0, start) + buffer.slice(end);
}

function deletePreviousWordAt(buffer, cursorIndex) {
  const before = buffer.slice(0, cursorIndex).replace(/[^\s]*\s*$/, "");
  return {
    buffer: before + buffer.slice(cursorIndex),
    cursorIndex: before.length,
  };
}

function moveCursorWordLeft(buffer, cursorIndex) {
  let index = cursorIndex;
  while (index > 0 && /\s/.test(buffer[index - 1])) index -= 1;
  while (index > 0 && !/\s/.test(buffer[index - 1])) index -= 1;
  return index;
}

function moveCursorWordRight(buffer, cursorIndex) {
  let index = cursorIndex;
  while (index < buffer.length && /\s/.test(buffer[index])) index += 1;
  while (index < buffer.length && !/\s/.test(buffer[index])) index += 1;
  return index;
}

function moveCursorLineStart(buffer, cursorIndex) {
  return getLineStartIndex(buffer, getCursorLocation(buffer, cursorIndex).lineIndex);
}

function moveCursorLineEnd(buffer, cursorIndex) {
  const { lineIndex } = getCursorLocation(buffer, cursorIndex);
  const lineStart = getLineStartIndex(buffer, lineIndex);
  const line = buffer.split("\n")[lineIndex] ?? "";
  return lineStart + line.length;
}

function getVisualRowsForLine(line, contentWidth) {
  const width = Math.max(1, contentWidth);
  if (line.length === 0) return [""];

  const rows = [];
  for (let start = 0; start < line.length; start += width) {
    rows.push(line.slice(start, start + width));
  }
  return rows;
}

function getVisualCursorLocation(line, column, contentWidth) {
  const width = Math.max(1, contentWidth);
  return {
    visualRowIndex: Math.floor(column / width),
    visualColumn: column % width,
  };
}

function isSubmitKey(key) {
  return key === "\r";
}

function isNewlineKey(key) {
  return key === "\x0a"
    || key === "\x1b[13;2u"
    || key === "\x1b[13;2~"
    || key === "\x1b[27;2;13~";
}

function isArrowUp(key) {
  return key === "\x1b[A";
}

function isArrowDown(key) {
  return key === "\x1b[B";
}

function isHistoryPreviousKey(key) {
  return key === "\x10";
}

function isHistoryNextKey(key) {
  return key === "\x0e";
}

function isArrowLeft(key) {
  return key === "\x1b[D";
}

function isArrowRight(key) {
  return key === "\x1b[C";
}

function isWordLeft(key) {
  return key === "\x1bb" || key === "\x1b[1;3D" || key === "\x1b[1;5D";
}

function isWordRight(key) {
  return key === "\x1bf" || key === "\x1b[1;3C" || key === "\x1b[1;5C";
}

function isLineStartKey(key) {
  return key === "\x01" || key === "\x1b[H" || key === "\x1bOH" || key === "\x1b[1~" || key === "\x1b[1;9D";
}

function isLineEndKey(key) {
  return key === "\x05" || key === "\x1b[F" || key === "\x1bOF" || key === "\x1b[4~" || key === "\x1b[1;9C";
}

function getActiveFileMention(buffer, cursorIndex) {
  const beforeCursor = buffer.slice(0, cursorIndex);
  const match = beforeCursor.match(/(^|\s)@([^\s]*)$/);
  if (!match) return null;

  const token = match[0].trimStart();
  const start = cursorIndex - token.length;
  return {
    start,
    end: cursorIndex,
    query: match[2] ?? "",
  };
}

function completeFileMention(buffer, mention, filePath) {
  return `${buffer.slice(0, mention.start)}@${filePath}${buffer.slice(mention.end)}`;
}

async function walkFiles(rootDir, currentDir = rootDir, results = []) {
  let entries;
  try {
    entries = await fs.readdir(currentDir, { withFileTypes: true });
  } catch {
    return results;
  }

  for (const entry of entries) {
    if (FILE_WALK_SKIP.has(entry.name)) continue;
    const fullPath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      await walkFiles(rootDir, fullPath, results);
      continue;
    }
    if (!entry.isFile()) continue;

    const relativePath = path.relative(rootDir, fullPath).split(path.sep).join("/");
    results.push(relativePath);
  }

  return results;
}

async function loadFileSuggestions(cwd) {
  const files = await walkFiles(cwd);
  return files.sort((a, b) => a.localeCompare(b));
}

function renderStatusbar(status, width) {
  if (!status) return null;
  const template =
    status.template ??
    "{folder} | {model} | {thinking} | {messages} msgs | {session_tokens} out";
  return template
    .replaceAll("{folder}", status.folder ?? "–")
    .replaceAll("{model}", status.model ?? "–")
    .replaceAll("{thinking}", status.thinking ?? "–")
    .replaceAll("{tokens}", status.tokens ?? "–")
    .replaceAll("{messages}", status.messages ?? "–")
    .replaceAll("{session_tokens}", status.sessionTokens ?? "–")
    .replaceAll("{session_time}", status.sessionTime ?? "–")
    .slice(0, Math.max(0, width + 20));
}

export function renderInputBox(buffer, suggestions = [], selectedIdx = 0, theme = {}, state = createRenderState(), status = null, cursorIndex = buffer.length, usageHint = null) {
  const frame = buildInputFrame(buffer, suggestions, selectedIdx, theme, status, cursorIndex, usageHint);
  clearRenderedState(state);
  process.stdout.write(frame.text);
  state.cursorUpLines = frame.cursorUpLines;
  state.blockHeight = frame.blockHeight;
  state.totalRenderedLines = frame.blockHeight;
  return state;
}

function buildInputFrame(buffer, suggestions = [], selectedIdx = 0, theme = {}, status = null, cursorIndex = buffer.length, usageHint = null) {
  const bufferLines = buffer.split("\n");
  const cursor = getCursorLocation(buffer, cursorIndex);
  const activeSuggestions = bufferLines.length === 1 ? suggestions : [];
  const maxSuggestions = Math.max(1, theme?.layout?.maxSuggestions ?? 8);
  const suggestionWindowStart = Math.min(
    Math.max(0, selectedIdx - Math.floor(maxSuggestions / 2)),
    Math.max(0, activeSuggestions.length - maxSuggestions),
  );
  const visibleSuggestions = activeSuggestions.slice(
    suggestionWindowStart,
    suggestionWindowStart + maxSuggestions,
  );
  const suggestionCount = visibleSuggestions.length;
  const prompt = theme?.symbols?.prompt ?? "❯";
  const promptColor = theme?.colors?.input ?? chalk.cyan;
  const muted = theme?.colors?.muted ?? chalk.dim;
  const borderColor = theme?.colors?.border ?? chalk.dim;
  const frame = theme?.symbols?.frame ?? {};
  const topLeft = frame.topLeft ?? "╭";
  const topRight = frame.topRight ?? "╮";
  const bottomLeft = frame.bottomLeft ?? "╰";
  const bottomRight = frame.bottomRight ?? "╯";
  const horizontal = frame.horizontal ?? "─";
  const vertical = frame.vertical ?? "│";
  const padding = " ".repeat(theme?.layout?.inputPaddingX ?? 0);
  const width = frameWidth();
  const plainPrefixLength = 4 + padding.length;
  const contentWidth = Math.max(1, width - plainPrefixLength - 1);
  const visualLines = [];
  let cursorVisualLineIndex = 0;
  let cursorVisualColumn = 0;

  for (let lineIndex = 0; lineIndex < bufferLines.length; lineIndex += 1) {
    const rows = getVisualRowsForLine(bufferLines[lineIndex], contentWidth);
    if (lineIndex === cursor.lineIndex) {
      const visualCursor = getVisualCursorLocation(
        bufferLines[lineIndex] ?? "",
        cursor.column,
        contentWidth,
      );
      while (visualCursor.visualRowIndex >= rows.length) {
        rows.push("");
      }
      cursorVisualLineIndex = visualLines.length + visualCursor.visualRowIndex;
      cursorVisualColumn = visualCursor.visualColumn;
    }
    for (let visualRowIndex = 0; visualRowIndex < rows.length; visualRowIndex += 1) {
      visualLines.push({
        text: rows[visualRowIndex],
        sourceLineIndex: lineIndex,
        visualRowIndex,
      });
    }
  }

  const parts = [
    borderColor(topLeft + horizontal.repeat(width - 2) + topRight),
    "\n",
  ];

  for (let index = 0; index < visualLines.length; index += 1) {
    if (index > 0) parts.push("\n");
    const visualLine = visualLines[index];
    const prefix =
      visualLine.sourceLineIndex === 0 && visualLine.visualRowIndex === 0
        ? `${borderColor(vertical)} ${padding}${promptColor(prompt)} `
        : `${borderColor(vertical)} ${padding}${muted("  ")}`;
    const isFirstVisualLine =
      visualLine.sourceLineIndex === 0 && visualLine.visualRowIndex === 0;
    const rawContent =
      isFirstVisualLine && usageHint?.text
        ? `${visualLine.text}${usageHint.text}`
        : visualLine.text;
    const content = fitText(rawContent, contentWidth);
    const visibleText = isFirstVisualLine && usageHint?.text
      ? content.slice(0, Math.min(visualLine.text.length, content.length))
      : content;
    const hintText = isFirstVisualLine && usageHint?.text
      ? content.slice(visibleText.length)
      : "";
    const line = prefix + visibleText + (hintText ? chalk.dim(hintText) : "");
    const plainLength = plainPrefixLength + content.length;
    parts.push(line + " ".repeat(Math.max(0, width - 1 - plainLength)) + borderColor(vertical));
  }

  for (let index = 0; index < suggestionCount; index += 1) {
    const suggestion = visibleSuggestions[index];
    const absoluteIndex = suggestionWindowStart + index;
    const selected = absoluteIndex === selectedIdx;
    const labelWidth = Math.max(4, Math.min(14, Math.floor((width - 6) / 2)));
    const label = fitText(suggestion.label, labelWidth);
    const descriptionWidth = Math.max(0, width - 6 - labelWidth - 2);
    const description = chalk.dim(fitText(suggestion.description, descriptionWidth));

    parts.push("\n");
    if (selected) {
      const selContent = `${padding}` + chalk.cyan("▸ ") + chalk.bold(label) + "  " + description;
      parts.push(
        `${borderColor(vertical)} ${selContent}${borderColor(vertical)}`,
      );
      continue;
    }

    const unselContent = `${padding}  ` + chalk.dim(label) + "  " + description;
    parts.push(`${borderColor(vertical)} ${unselContent}${borderColor(vertical)}`);
  }

  if (activeSuggestions.length > suggestionCount) {
    parts.push("\n");
    const from = suggestionWindowStart + 1;
    const to = suggestionWindowStart + suggestionCount;
    const summary = chalk.dim(`${from}-${to}/${activeSuggestions.length}`);
    parts.push(`${borderColor(vertical)} ${padding}  ${summary}`);
  }

  const statusbar = renderStatusbar(status, width - 2);
  const statusLineCount = statusbar ? 1 : 0;

  parts.push("\n");
  parts.push(borderColor(bottomLeft + horizontal.repeat(width - 2) + bottomRight));

  if (statusbar) {
    parts.push("\n");
    parts.push(chalk.dim(`  ${fitText(statusbar, width - 2)}`));
  }

  const extraSummaryLine = activeSuggestions.length > suggestionCount ? 1 : 0;
  if (suggestionCount > 0) {
    parts.push(`\x1b[${suggestionCount + extraSummaryLine + statusLineCount + 1}A`);
  } else {
    parts.push(`\x1b[${statusLineCount + 1}A`);
  }

  const linesUpFromLast = Math.max(0, (visualLines.length - 1) - cursorVisualLineIndex);
  if (linesUpFromLast > 0) {
    parts.push(`\x1b[${linesUpFromLast}A`);
  }

  parts.push(`\r\x1b[${plainPrefixLength + cursorVisualColumn}C`);

  const blockHeight = 1 + visualLines.length + suggestionCount + extraSummaryLine + 1 + statusLineCount;
  return {
    text: parts.join(""),
    cursorUpLines: cursorVisualLineIndex + 1,
    blockHeight,
    width,
  };
}

export function clearRenderedInputBox(state) {
  clearRenderedState(state);
  resetRenderState(state);
}

function deletePreviousWord(buffer) {
  return buffer.replace(/[^\s]*\s*$/, "");
}

export function promptInput(
  i18n,
  theme,
  initialBuffer = "",
  status = null,
  onResize = null,
  promptHistory = [],
  options = {},
) {
  const renderState = createRenderState();

  return new Promise((resolve) => {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf8");

    let buffer = initialBuffer;
    let cursorIndex = buffer.length;
    let suggestions = [];
    let selectedIdx = 0;
    // History navigation: -1 = not navigating (current input), 0..n-1 = index into history (newest first)
    let historyIdx = -1;
    let savedBuffer = "";
    let tokenAnimation = null;
    let fileIndex = [];

    function rerender() {
      renderInputBox(
        buffer,
        suggestions,
        selectedIdx,
        theme,
        renderState,
        status,
        cursorIndex,
        getUsageHint(buffer),
      );
    }

    function updateSuggestions() {
      const mention = getActiveFileMention(buffer, cursorIndex);
      if (mention) {
        const query = mention.query.toLowerCase();
        suggestions = fileIndex
          .filter((filePath) => filePath.toLowerCase().includes(query))
          .slice(0, FILE_SUGGESTION_LIMIT)
          .map((filePath) => ({
            kind: "file",
            label: `@${filePath}`,
            description: "file",
            complete: completeFileMention(buffer, mention, filePath),
          }));
        selectedIdx = 0;
        return;
      }

      suggestions = getSuggestions(buffer, i18n);
      selectedIdx = 0;
    }

    function leaveHistoryNavigation() {
      if (historyIdx === -1) return;
      historyIdx = -1;
    }

    function showPreviousHistoryItem() {
      if (promptHistory.length === 0) return;
      if (historyIdx === -1) savedBuffer = buffer;
      historyIdx = Math.min(historyIdx + 1, promptHistory.length - 1);
      buffer = promptHistory[historyIdx];
      cursorIndex = buffer.length;
      suggestions = [];
      rerender();
    }

    function showNextHistoryItem() {
      if (historyIdx < 0) return;
      historyIdx -= 1;
      buffer = historyIdx === -1 ? savedBuffer : promptHistory[historyIdx];
      cursorIndex = buffer.length;
      suggestions = [];
      rerender();
    }

    function resetAndRerender() {
      resetRenderState(renderState);
      rerender();
    }

    function handleResize() {
      if (onResize) {
        // The chat scene will do a full screen redraw, which correctly
        // clears all content. Don't try to cursor-up-and-patch here
        // because terminal reflow invalidates our line count tracking.
        resetRenderState(renderState);
        onResize(rerender);
        return;
      }
      // Standalone mode: best-effort clear (may leave artifacts on reflow).
      clearRenderedState(renderState);
      resetRenderState(renderState);
      rerender();
    }

    function cleanup() {
      if (tokenAnimation) {
        clearInterval(tokenAnimation);
        tokenAnimation = null;
      }
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.removeListener("data", onData);
      process.stdout.removeListener("resize", handleResize);
    }

    function startStatusAnimations() {
      if (!status) return;
      const from = status.sessionTokensFrom;
      const target = status.sessionTokensTarget;
      if (!Number.isFinite(from) || !Number.isFinite(target) || target <= from) {
        return;
      }

      const formatTokens =
        typeof status.formatSessionTokens === "function"
          ? status.formatSessionTokens
          : (value) => String(value);
      const startedAt = Date.now();
      const durationMs = Math.min(1200, Math.max(350, (target - from) * 3));

      tokenAnimation = setInterval(() => {
        const elapsed = Date.now() - startedAt;
        const progress = Math.min(1, elapsed / durationMs);
        const nextValue = Math.floor(from + (target - from) * progress);
        status.sessionTokens = formatTokens(nextValue);
        rerender();

        if (progress >= 1) {
          clearInterval(tokenAnimation);
          tokenAnimation = null;
          status.sessionTokensFrom = target;
          status.sessionTokens = formatTokens(target);
          rerender();
        }
      }, 100);
    }

    function onData(key) {
      if (key === "\x03") {
        clearRenderedInputBox(renderState);
        cleanup();
        // Restore terminal: show cursor, clear line, move to start.
        process.stdout.write("\x1b[?25h\r\x1b[J\n");
        process.exit(0);
      }

      if (isSubmitKey(key)) {
        clearRenderedInputBox(renderState);
        cleanup();
        resolve(buffer);
        return;
      }

      if (isNewlineKey(key)) {
        leaveHistoryNavigation();
        buffer = insertAt(buffer, cursorIndex, "\n");
        cursorIndex += 1;
        suggestions = [];
        selectedIdx = 0;
        rerender();
        return;
      }

      if (key === "\x09") {
        if (suggestions.length > 0 && !buffer.includes("\n")) {
          buffer = suggestions[selectedIdx].complete;
          cursorIndex = buffer.length;
          updateSuggestions();
          rerender();
        }
        return;
      }

      if (key === "\x7f" || key === "\b") {
        if (cursorIndex > 0) {
          leaveHistoryNavigation();
          buffer = deleteRange(buffer, cursorIndex - 1, cursorIndex);
          cursorIndex -= 1;
          updateSuggestions();
          rerender();
        }
        return;
      }

      if (key === "\x1b\x7f" || key === "\x17") {
        if (cursorIndex > 0) {
          leaveHistoryNavigation();
          const next = deletePreviousWordAt(buffer, cursorIndex);
          buffer = next.buffer;
          cursorIndex = next.cursorIndex;
          updateSuggestions();
          rerender();
        }
        return;
      }

      if (key === "\x15" || key === "\x1b[3;9~") {
        if (buffer.length > 0) {
          leaveHistoryNavigation();
          buffer = "";
          cursorIndex = 0;
          suggestions = [];
          selectedIdx = 0;
          rerender();
        }
        return;
      }

      if (isHistoryPreviousKey(key)) {
        showPreviousHistoryItem();
        return;
      }

      if (isHistoryNextKey(key)) {
        showNextHistoryItem();
        return;
      }

      if (isArrowUp(key)) {
        if (suggestions.length > 0 && !buffer.includes("\n")) {
          selectedIdx = Math.max(0, selectedIdx - 1);
          rerender();
          return;
        }

        const moved = moveCursorVertical(buffer, cursorIndex, -1);
        if (moved.moved) {
          cursorIndex = moved.cursorIndex;
          rerender();
        } else if (promptHistory.length > 0) {
          showPreviousHistoryItem();
        }
        return;
      }

      if (isArrowDown(key)) {
        if (suggestions.length > 0 && !buffer.includes("\n")) {
          selectedIdx = Math.min(suggestions.length - 1, selectedIdx + 1);
          rerender();
          return;
        }

        const moved = moveCursorVertical(buffer, cursorIndex, 1);
        if (moved.moved) {
          cursorIndex = moved.cursorIndex;
          rerender();
        } else if (historyIdx >= 0) {
          showNextHistoryItem();
        }
        return;
      }

      if (isArrowLeft(key)) {
        cursorIndex = Math.max(0, cursorIndex - 1);
        rerender();
        return;
      }

      if (isArrowRight(key)) {
        cursorIndex = Math.min(buffer.length, cursorIndex + 1);
        rerender();
        return;
      }

      if (isWordLeft(key)) {
        cursorIndex = moveCursorWordLeft(buffer, cursorIndex);
        rerender();
        return;
      }

      if (isWordRight(key)) {
        cursorIndex = moveCursorWordRight(buffer, cursorIndex);
        rerender();
        return;
      }

      if (isLineStartKey(key)) {
        cursorIndex = moveCursorLineStart(buffer, cursorIndex);
        rerender();
        return;
      }

      if (isLineEndKey(key)) {
        cursorIndex = moveCursorLineEnd(buffer, cursorIndex);
        rerender();
        return;
      }

      if (key.startsWith("\x1b")) return;

      leaveHistoryNavigation();
      buffer = insertAt(buffer, cursorIndex, key);
      cursorIndex += key.length;
      updateSuggestions();
      rerender();
    }

    process.stdin.on("data", onData);
    process.stdout.on("resize", handleResize);
    resetAndRerender();
    startStatusAnimations();

    if (options.cwd) {
      loadFileSuggestions(options.cwd)
        .then((files) => {
          fileIndex = files;
          updateSuggestions();
          rerender();
        })
        .catch(() => {});
    }
  });
}

export function createPassiveInputBuffer(
  i18n,
  theme,
  {
    onEscape = null,
    status = null,
    autoResize = true,
    externalRender = false,
    onChange = null,
  } = {},
) {
  let buffer = "";
  const renderState = createRenderState();
  let cursorIndex = 0;

  function render() {
    if (externalRender) {
      onChange?.();
      return;
    }
    renderInputBox(buffer, [], 0, theme, renderState, status, cursorIndex);
  }

  function onData(key) {
    if (key === "\x03") {
      process.stdout.write("\x1b[?25h\r\x1b[J\n");
      process.exit(0);
    }

    if (key === "\x1b" && onEscape) {
      onEscape();
      return;
    }

    if (isSubmitKey(key) || isNewlineKey(key)) return;

    if (key === "\x7f" || key === "\b") {
      if (cursorIndex > 0) {
        buffer = deleteRange(buffer, cursorIndex - 1, cursorIndex);
        cursorIndex -= 1;
        render();
      }
      return;
    }

    if (key === "\x1b\x7f" || key === "\x17") {
      const next = deletePreviousWordAt(buffer, cursorIndex);
      buffer = next.buffer;
      cursorIndex = next.cursorIndex;
      render();
      return;
    }

    if (key === "\x15" || key === "\x1b[3;9~") {
      buffer = "";
      cursorIndex = 0;
      render();
      return;
    }

    if (isArrowLeft(key)) {
      cursorIndex = Math.max(0, cursorIndex - 1);
      render();
      return;
    }

    if (isArrowRight(key)) {
      cursorIndex = Math.min(buffer.length, cursorIndex + 1);
      render();
      return;
    }

    if (isWordLeft(key)) {
      cursorIndex = moveCursorWordLeft(buffer, cursorIndex);
      render();
      return;
    }

    if (isWordRight(key)) {
      cursorIndex = moveCursorWordRight(buffer, cursorIndex);
      render();
      return;
    }

    if (isLineStartKey(key)) {
      cursorIndex = moveCursorLineStart(buffer, cursorIndex);
      render();
      return;
    }

    if (isLineEndKey(key)) {
      cursorIndex = moveCursorLineEnd(buffer, cursorIndex);
      render();
      return;
    }

    if (isArrowUp(key) || isArrowDown(key)) {
      const moved = moveCursorVertical(buffer, cursorIndex, isArrowUp(key) ? -1 : 1);
      if (moved.moved) {
        cursorIndex = moved.cursorIndex;
        render();
      }
      return;
    }

    if (key.startsWith("\x1b")) return;

    buffer = insertAt(buffer, cursorIndex, key);
    cursorIndex += key.length;
    render();
  }

  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", onData);
  if (autoResize) {
    process.stdout.on("resize", render);
  }
  render();

  return {
    render,
    getFrame() {
      return buildInputFrame(buffer, [], 0, theme, status, cursorIndex);
    },
    getMetrics() {
      return { ...renderState };
    },
    resetMetrics() {
      resetRenderState(renderState);
    },
    getBuffer() {
      return buffer;
    },
    stop() {
      process.stdin.removeListener("data", onData);
      if (autoResize) {
        process.stdout.removeListener("resize", render);
      }
      process.stdin.setRawMode(false);
      process.stdin.pause();
      return buffer;
    },
    clear() {
      if (externalRender) {
        resetRenderState(renderState);
        return;
      }
      clearRenderedInputBox(renderState);
    },
  };
}
