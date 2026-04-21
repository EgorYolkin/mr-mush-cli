import chalk from "chalk";
import { getSuggestions } from "../commands/index.js";

function frameWidth() {
  return Math.min(Math.max(72, process.stdout.columns || 96), 92);
}

function createRenderState() {
  return { renderedLines: 0 };
}

function fitLine(value, width) {
  if (value.length <= width) return value + " ".repeat(width - value.length);
  if (width <= 1) return " ".repeat(width);
  return value.slice(0, width - 1) + "…";
}

function renderStatusbar(status, width) {
  if (!status) return null;
  const template = status.template ?? "{folder} | {model} | {thinking} | {tokens}";
  return template
    .replaceAll("{folder}", status.folder ?? "–")
    .replaceAll("{model}", status.model ?? "–")
    .replaceAll("{thinking}", status.thinking ?? "–")
    .replaceAll("{tokens}", status.tokens ?? "–")
    .slice(0, Math.max(0, width));
}

export function renderInputBox(buffer, suggestions = [], selectedIdx = 0, theme = {}, state = createRenderState(), status = null) {
  const bufferLines = buffer.split("\n");
  const bufferLineCount = bufferLines.length;
  const activeSuggestions = bufferLineCount === 1 ? suggestions : [];
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
  const innerWidth = width - 2;

  if (state.renderedLines > 0) {
    process.stdout.write(`\x1b[${state.renderedLines}A`);
  }
  process.stdout.write("\r\x1b[J");
  process.stdout.write(borderColor(topLeft + horizontal.repeat(width - 2) + topRight) + "\n");

  for (let index = 0; index < bufferLineCount; index += 1) {
    if (index > 0) process.stdout.write("\n");
    const prefix =
      index === 0
        ? `${borderColor(vertical)} ${padding}${promptColor(prompt)} `
        : `${borderColor(vertical)} ${padding}${muted("  ")}`;
    const line = prefix + bufferLines[index];
    const plainPrefixLength = 4 + padding.length;
    const plainLength = plainPrefixLength + bufferLines[index].length;
    process.stdout.write(line + " ".repeat(Math.max(0, width - 1 - plainLength)) + borderColor(vertical));
  }

  for (let index = 0; index < suggestionCount; index += 1) {
    const suggestion = visibleSuggestions[index];
    const absoluteIndex = suggestionWindowStart + index;
    const selected = absoluteIndex === selectedIdx;
    const label = suggestion.label.padEnd(14);
    const description = chalk.dim(suggestion.description);

    process.stdout.write("\n");
    if (selected) {
      process.stdout.write(
        `${borderColor(vertical)} ${padding}` + chalk.cyan("▸ ") + chalk.bold(label) + "  " + description,
      );
      continue;
    }

    process.stdout.write(`${borderColor(vertical)} ${padding}  ` + chalk.dim(label) + "  " + description);
  }

  if (activeSuggestions.length > suggestionCount) {
    process.stdout.write("\n");
    const from = suggestionWindowStart + 1;
    const to = suggestionWindowStart + suggestionCount;
    const summary = chalk.dim(`${from}-${to}/${activeSuggestions.length}`);
    process.stdout.write(`${borderColor(vertical)} ${padding}  ${summary}`);
  }

  const statusbar = renderStatusbar(status, innerWidth - 2);
  const statusLineCount = statusbar ? 1 : 0;
  if (statusbar) {
    process.stdout.write("\n");
    const content = ` ${fitLine(statusbar, innerWidth - 2)} `;
    process.stdout.write(`${borderColor(vertical)}${chalk.dim(content)}${borderColor(vertical)}`);
  }

  process.stdout.write("\n");
  process.stdout.write(borderColor(bottomLeft + horizontal.repeat(width - 2) + bottomRight));

  const extraSummaryLine = activeSuggestions.length > suggestionCount ? 1 : 0;
  if (suggestionCount > 0) {
    process.stdout.write(`\x1b[${suggestionCount + extraSummaryLine + statusLineCount + 1}A`);
  } else {
    process.stdout.write(`\x1b[${statusLineCount + 1}A`);
  }

  const lastLine = bufferLines[bufferLineCount - 1];
  process.stdout.write(`\r\x1b[${padding.length + 4 + lastLine.length}C`);

  state.renderedLines = bufferLineCount;
  return state;
}

export function clearRenderedInputBox(state) {
  if (state?.renderedLines > 0) {
    process.stdout.write(`\x1b[${state.renderedLines}A`);
  }
  process.stdout.write("\r\x1b[J");
  if (state) state.renderedLines = 0;
}

function deletePreviousWord(buffer) {
  return buffer.replace(/[^\s]*\s*$/, "");
}

export function promptInput(i18n, theme, initialBuffer = "", status = null) {
  const renderState = createRenderState();

  return new Promise((resolve) => {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf8");

    let buffer = initialBuffer;
    let suggestions = [];
    let selectedIdx = 0;

    function cleanup() {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.removeListener("data", onData);
    }

    function onData(key) {
      if (key === "\x03") {
        process.stdout.write("\r\x1b[J\n");
        cleanup();
        process.exit(0);
      }

      if (key === "\r") {
        clearRenderedInputBox(renderState);
        cleanup();
        resolve(buffer);
        return;
      }

      if (key === "\x0a" || key === "\x1b[13;2u") {
        buffer += "\n";
        suggestions = [];
        selectedIdx = 0;
          renderInputBox(buffer, suggestions, selectedIdx, theme, renderState, status);
        return;
      }

      if (key === "\x09") {
        if (suggestions.length > 0 && !buffer.includes("\n")) {
          buffer = suggestions[selectedIdx].complete;
          suggestions = getSuggestions(buffer, i18n);
          selectedIdx = 0;
          renderInputBox(buffer, suggestions, selectedIdx, theme, renderState, status);
        }
        return;
      }

      if (key === "\x7f" || key === "\b") {
        if (buffer.length > 0) {
          buffer = buffer.slice(0, -1);
          suggestions = getSuggestions(buffer, i18n);
          selectedIdx = 0;
          renderInputBox(buffer, suggestions, selectedIdx, theme, renderState, status);
        }
        return;
      }

      if (key === "\x1b\x7f" || key === "\x17") {
        if (buffer.length > 0) {
          buffer = deletePreviousWord(buffer);
          suggestions = getSuggestions(buffer, i18n);
          selectedIdx = 0;
          renderInputBox(buffer, suggestions, selectedIdx, theme, renderState, status);
        }
        return;
      }

      if (key === "\x15" || key === "\x1b[3;9~") {
        if (buffer.length > 0) {
          buffer = "";
          suggestions = [];
          selectedIdx = 0;
          renderInputBox(buffer, suggestions, selectedIdx, theme, renderState, status);
        }
        return;
      }

      if (key === "\x1b[A") {
        if (suggestions.length > 0) {
          selectedIdx = (selectedIdx - 1 + suggestions.length) % suggestions.length;
          renderInputBox(buffer, suggestions, selectedIdx, theme, renderState, status);
        }
        return;
      }

      if (key === "\x1b[B") {
        if (suggestions.length > 0) {
          selectedIdx = (selectedIdx + 1) % suggestions.length;
          renderInputBox(buffer, suggestions, selectedIdx, theme, renderState, status);
        }
        return;
      }

      if (key.startsWith("\x1b")) return;

      buffer += key;
      suggestions = getSuggestions(buffer, i18n);
      selectedIdx = 0;
      renderInputBox(buffer, suggestions, selectedIdx, theme, renderState, status);
    }

    process.stdin.on("data", onData);
    renderInputBox(buffer, suggestions, selectedIdx, theme, renderState, status);
  });
}

export function createPassiveInputBuffer(i18n, theme, { onEscape = null, status = null } = {}) {
  let buffer = "";
  const renderState = createRenderState();

  function render() {
    renderInputBox(buffer, [], 0, theme, renderState, status);
  }

  function onData(key) {
    if (key === "\x03") {
      process.stdout.write("\r\x1b[J\n");
      process.exit(0);
    }

    if (key === "\x1b" && onEscape) {
      onEscape();
      return;
    }

    if (key === "\r" || key === "\x0a") return;
    if (key.startsWith("\x1b") && key !== "\x1b\x7f" && key !== "\x1b[3;9~") return;

    if (key === "\x7f" || key === "\b") {
      buffer = buffer.slice(0, -1);
      render();
      return;
    }

    if (key === "\x1b\x7f" || key === "\x17") {
      buffer = deletePreviousWord(buffer);
      render();
      return;
    }

    if (key === "\x15" || key === "\x1b[3;9~") {
      buffer = "";
      render();
      return;
    }

    buffer += key;
    render();
  }

  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", onData);
  render();

  return {
    render,
    getBuffer() {
      return buffer;
    },
    stop() {
      process.stdin.removeListener("data", onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      return buffer;
    },
    clear() {
      clearRenderedInputBox(renderState);
    },
  };
}
