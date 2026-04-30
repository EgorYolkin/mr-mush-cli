import chalk from "chalk";
import { listSessions, loadSession, deleteSession } from "./session.js";
import { fitText } from "../ui/components/layout.js";

function browserFrameWidth() {
  const columns = process.stdout.columns || 96;
  return Math.max(40, Math.min(columns - 2, 92));
}

function formatTimeAgo(iso) {
  if (!iso) return "–";
  const time = new Date(iso).getTime();
  if (Number.isNaN(time)) return "–";

  const diffMs = Math.max(0, Date.now() - time);
  const diffSeconds = Math.floor(diffMs / 1000);
  if (diffSeconds < 60) return `${diffSeconds}s ago`;

  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) return `${diffMinutes}m ago`;

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;

  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

function sortSessions(list, sortMode) {
  const sessions = [...list];
  const sortField = sortMode === "updated" ? "updatedAt" : "createdAt";
  return sessions.sort((a, b) => (b[sortField] ?? "").localeCompare(a[sortField] ?? ""));
}

function filterSessions(list, query) {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return [...list];

  return list.filter((session) => {
    const title = (session.title ?? "").toLowerCase();
    return title.includes(normalizedQuery);
  });
}

function clampCursor(cursor, value) {
  return Math.max(0, Math.min(cursor, value.length));
}

function moveCursorByWordLeft(value, cursor) {
  let nextCursor = clampCursor(cursor, value);
  while (nextCursor > 0 && value[nextCursor - 1] === " ") nextCursor -= 1;
  while (nextCursor > 0 && value[nextCursor - 1] !== " ") nextCursor -= 1;
  return nextCursor;
}

function moveCursorByWordRight(value, cursor) {
  let nextCursor = clampCursor(cursor, value);
  while (nextCursor < value.length && value[nextCursor] === " ") nextCursor += 1;
  while (nextCursor < value.length && value[nextCursor] !== " ") nextCursor += 1;
  return nextCursor;
}

function deleteRange(value, start, end) {
  return value.slice(0, start) + value.slice(end);
}

function renderSearchQuery(searchQuery, searchCursor) {
  const cursor = clampCursor(searchCursor, searchQuery);
  const left = searchQuery.slice(0, cursor);
  const current = searchQuery[cursor] ?? " ";
  const right = searchQuery.slice(cursor + (cursor < searchQuery.length ? 1 : 0));
  return `${left}${chalk.inverse(current)}${right}`;
}

function renderBrowser(
  sessions,
  selectedIdx,
  scrollOffset,
  theme = {},
  sortMode = "created",
  searchQuery = "",
  searchCursor = 0,
) {
  const width = browserFrameWidth();
  const innerWidth = width - 2;
  const frame = theme.symbols?.frame ?? {};
  const topLeft = frame.topLeft ?? "╭";
  const topRight = frame.topRight ?? "╮";
  const bottomLeft = frame.bottomLeft ?? "╰";
  const bottomRight = frame.bottomRight ?? "╯";
  const horizontal = frame.horizontal ?? "─";
  const vertical = frame.vertical ?? "│";
  const border = theme.colors?.border ?? chalk.dim;
  const accent = theme.colors?.accent ?? chalk.hex("#a855f7");
  const muted = theme.colors?.muted ?? chalk.dim;

  const maxVisible = Math.min(10, Math.max(1, (process.stdout.rows || 24) - 6));
  const visibleSessions = sessions.slice(scrollOffset, scrollOffset + maxVisible);

  const lines = [];

  // Header
  const titleText = ` resume session · ${sortMode} `;
  const searchText = searchQuery ? ` search: ${renderSearchQuery(searchQuery, searchCursor)} ` : "";
  const plainSearchText = searchQuery ? ` search: ${searchQuery} ` : "";
  const headerText = titleText + plainSearchText;
  const titleFits = innerWidth >= headerText.length + 4;
  if (titleFits) {
    const ruleRight = width - headerText.length - 5;
    lines.push(
      border(topLeft + horizontal.repeat(3)) +
      accent(titleText) +
      (searchQuery ? accent(searchText) : "") +
      border(horizontal.repeat(Math.max(0, ruleRight))) +
      border(topRight),
    );
  } else {
    lines.push(border(topLeft + horizontal.repeat(width - 2) + topRight));
  }

  if (sessions.length === 0) {
    const emptyText = searchQuery ? `  no chats for "${searchQuery}"` : "  no sessions yet";
    lines.push(border(vertical) + muted(fitText(emptyText, innerWidth)) + border(vertical));
  } else {
    // Adapt meta column width to available space: wide screens show full meta, narrow screens shrink it
    const minTitleWidth = 8;
    const maxMetaWidth = Math.min(38, Math.max(0, innerWidth - minTitleWidth - 4));

    for (let i = 0; i < visibleSessions.length; i++) {
      const session = visibleSessions[i];
      const absoluteIdx = scrollOffset + i;
      const selected = absoluteIdx === selectedIdx;
      const title = session.title ?? "(untitled)";

      let meta;
      if (innerWidth >= 40) {
        meta = `${session.messageCount ?? 0} msgs · ${formatTimeAgo(session.createdAt ?? session.updatedAt)}`;
      } else {
        meta = `${session.messageCount ?? 0}`;
      }

      const metaWidth = Math.min(meta.length, maxMetaWidth);
      const titleWidth = Math.max(1, innerWidth - metaWidth - 4);
      const indicator = selected ? "> " : "  ";

      const row =
        (selected ? chalk.cyan(indicator) : indicator) +
        (selected ? chalk.bold(fitText(title, titleWidth)) : muted(fitText(title, titleWidth))) +
        "  " +
        muted(fitText(meta, metaWidth));

      lines.push(border(vertical) + row + border(vertical));
    }

    if (sessions.length > maxVisible) {
      const from = scrollOffset + 1;
      const to = Math.min(scrollOffset + maxVisible, sessions.length);
      lines.push(border(vertical) + muted(fitText(`  ${from}–${to} of ${sessions.length}`, innerWidth)) + border(vertical));
    }
  }

  const hints = innerWidth >= 54
    ? "  type search   ←→ edit   ⌥←→ word   ⌥⌫ word   tab sort   ^d delete"
    : "  type  ←→  ⌥  tab  ^d";
  lines.push(border(vertical) + muted(fitText(hints, innerWidth)) + border(vertical));
  lines.push(border(bottomLeft + horizontal.repeat(width - 2) + bottomRight));

  return lines;
}

export function openSessionBrowser(historyDir, theme = {}) {
  return new Promise((resolve) => {
    let allSessions = [];
    let sessions = [];
    let selectedIdx = 0;
    let scrollOffset = 0;
    let sortMode = "created";
    let searchQuery = "";
    let searchCursor = 0;

    function maxVisible() {
      return Math.min(10, Math.max(1, (process.stdout.rows || 24) - 8));
    }

    function clampScroll() {
      const mv = maxVisible();
      if (selectedIdx < scrollOffset) scrollOffset = selectedIdx;
      if (selectedIdx >= scrollOffset + mv) scrollOffset = selectedIdx - mv + 1;
    }

    function refreshSessions(nextSortMode = sortMode, nextSearchQuery = searchQuery) {
      const filteredSessions = filterSessions(allSessions, nextSearchQuery);
      sessions = sortSessions(filteredSessions, nextSortMode);
      sortMode = nextSortMode;
      searchQuery = nextSearchQuery;
      searchCursor = clampCursor(searchCursor, searchQuery);
      if (selectedIdx >= sessions.length) {
        selectedIdx = Math.max(0, sessions.length - 1);
      }
      clampScroll();
    }

    function applySort(nextSortMode = sortMode) {
      refreshSessions(nextSortMode, searchQuery);
    }

    function applySearch(nextSearchQuery) {
      selectedIdx = 0;
      scrollOffset = 0;
      searchCursor = clampCursor(searchCursor, nextSearchQuery);
      refreshSessions(sortMode, nextSearchQuery);
    }

    function draw() {
      const lines = renderBrowser(
        sessions,
        selectedIdx,
        scrollOffset,
        theme,
        sortMode,
        searchQuery,
        searchCursor,
      );
      process.stdout.write("\x1b[3J\x1b[2J\x1b[H");
      process.stdout.write(lines.join("\r\n") + "\r\n");
    }

    function onResize() {
      draw();
    }

    function cleanup() {
      process.stdout.write("\x1b[?25h"); // restore cursor
      process.stdout.removeListener("resize", onResize);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.removeListener("data", onData);
    }

    async function confirmDelete() {
      if (sessions.length === 0) return;
      const session = sessions[selectedIdx];
      await deleteSession(historyDir, session.id);
      const list = await listSessions(historyDir);
      allSessions = list.filter((s) => (s.messageCount ?? 0) > 0);
      refreshSessions(sortMode, searchQuery);
      draw();
    }

    function insertSearchText(value) {
      const nextQuery = searchQuery.slice(0, searchCursor) + value + searchQuery.slice(searchCursor);
      searchCursor += value.length;
      applySearch(nextQuery);
      draw();
    }

    function deleteBackwardChar() {
      if (searchCursor === 0) return;
      const nextQuery = deleteRange(searchQuery, searchCursor - 1, searchCursor);
      searchCursor -= 1;
      applySearch(nextQuery);
      draw();
    }

    function deleteBackwardWord() {
      if (searchCursor === 0) return;
      const nextCursor = moveCursorByWordLeft(searchQuery, searchCursor);
      const nextQuery = deleteRange(searchQuery, nextCursor, searchCursor);
      searchCursor = nextCursor;
      applySearch(nextQuery);
      draw();
    }

    function deleteToLineStart() {
      if (searchCursor === 0) return;
      const nextQuery = deleteRange(searchQuery, 0, searchCursor);
      searchCursor = 0;
      applySearch(nextQuery);
      draw();
    }

    function onData(key) {
      if (key === "\x03") {
        cleanup();
        process.stdout.write("\x1b[3J\x1b[2J\x1b[H");
        process.exit(0);
      }

      if (key === "\x1b" || key === "q") {
        cleanup();
        process.stdout.write("\x1b[3J\x1b[2J\x1b[H");
        resolve(null);
        return;
      }

      if (key === "\r") {
        if (sessions.length === 0) return;
        const session = sessions[selectedIdx];
        cleanup();
        process.stdout.write("\x1b[3J\x1b[2J\x1b[H");
        loadSession(historyDir, session.id).then(resolve).catch(() => resolve(null));
        return;
      }

      if (key === "\x09") {
        applySort(sortMode === "created" ? "updated" : "created");
        draw();
        return;
      }

      if (key === "\x01" || key === "\x1b[H" || key === "\x1bOH") {
        searchCursor = 0;
        draw();
        return;
      }

      if (key === "\x05" || key === "\x1b[F" || key === "\x1bOF") {
        searchCursor = searchQuery.length;
        draw();
        return;
      }

      if (key === "\x1b[D") {
        searchCursor = clampCursor(searchCursor - 1, searchQuery);
        draw();
        return;
      }

      if (key === "\x1b[C") {
        searchCursor = clampCursor(searchCursor + 1, searchQuery);
        draw();
        return;
      }

      if (key === "\x1bb" || key === "\x1b[1;3D" || key === "\x1b\x1b[D") {
        searchCursor = moveCursorByWordLeft(searchQuery, searchCursor);
        draw();
        return;
      }

      if (key === "\x1bf" || key === "\x1b[1;3C" || key === "\x1b\x1b[C") {
        searchCursor = moveCursorByWordRight(searchQuery, searchCursor);
        draw();
        return;
      }

      if (key === "\x1b[A") {
        if (selectedIdx > 0) {
          selectedIdx -= 1;
          clampScroll();
          draw();
        }
        return;
      }

      if (key === "\x1b[B") {
        if (selectedIdx < sessions.length - 1) {
          selectedIdx += 1;
          clampScroll();
          draw();
        }
        return;
      }

      if (key === "\x7f") {
        deleteBackwardChar();
        return;
      }

      if (key === "\x1b\x7f" || key === "\x1b\b") {
        deleteBackwardWord();
        return;
      }

      if (key === "\x04") {
        confirmDelete();
        return;
      }

      if (key === "\x15") {
        deleteToLineStart();
        return;
      }

      if (key >= " " && key !== "\x7f" && key.length === 1) {
        insertSearchText(key);
      }
    }

    // Filter out empty sessions before showing
    listSessions(historyDir).then((list) => {
      allSessions = list.filter((s) => (s.messageCount ?? 0) > 0);
      refreshSessions(sortMode, searchQuery);
      process.stdout.write("\x1b[?25l"); // hide cursor before first draw
      process.stdout.on("resize", onResize);
      process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", onData);
      draw();
    });
  });
}
