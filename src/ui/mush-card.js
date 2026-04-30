import chalk from "chalk";
import {
  charWidth,
  visibleLength,
  fitText,
  frameWidth,
} from "./components/layout.js";

function color(theme, name, fallback = chalk.white) {
  return theme.colors?.[name] ?? fallback;
}

function leadingWhitespace(value) {
  const match = value.match(/^ */);
  return match ? match[0].length : 0;
}

function shiftBlockLeft(lines, targetOffset) {
  const currentOffset = Math.min(...lines.map((line) => leadingWhitespace(line)));
  const shift = Math.max(0, currentOffset - Math.max(0, targetOffset));

  return lines.map((line) => {
    const removable = Math.min(leadingWhitespace(line), shift);
    const shifted = line.slice(removable);
    return fitText(shifted, visibleLength(line));
  });
}

function trimRight(value) {
  return String(value).replace(/[ \t]+$/g, "");
}

export function buildCardLines(context, rows = []) {
  const theme = context.ui?.theme ?? {};
  const frame = theme.symbols?.frame ?? {};
  const horizontal = frame.horizontal ?? "─";
  const topLeft = frame.topLeft ?? "╭";
  const bottomLeft = frame.bottomLeft ?? "╰";
  const vertical = frame.vertical ?? "│";
  const border = color(theme, "border", chalk.dim);
  const accent = color(theme, "accent", chalk.magenta);
  const width = frameWidth();
  const contentWidth = Math.max(1, width - 4);
  const titleText = fitText(` ${theme.layout?.splashTitle ?? "MR. MUSH"}`, contentWidth);
  const splash = theme.layout?.splash ?? [];
  const artRows = shiftBlockLeft(splash.map((line) => fitText(line, contentWidth)), 2);
  const footerRow = rows.at(-1) ?? null;
  const bodyRows = footerRow ? rows.slice(0, -1) : rows;

  const lines = [border(`${topLeft}${horizontal}`) + accent(trimRight(titleText))];

  const cardRows = [
    { text: "" },
    ...artRows.map((line) => ({ text: line, paint: accent })),
    { text: "" },
    ...bodyRows.map((row) => ({
      paint: row.paint ?? color(theme, "muted", chalk.dim),
      text: fitText(row.text, contentWidth),
    })),
  ];

  for (const row of cardRows) {
    const text = trimRight(row.text);
    lines.push(border(vertical) + (row.paint ? row.paint(text) : text));
  }

  const footerText = footerRow ? trimRight(fitText(footerRow.text, contentWidth)) : "";
  const footerPaint = footerRow?.paint ?? color(theme, "muted", chalk.dim);
  lines.push(border(`${bottomLeft}${horizontal}`) + (footerText ? footerPaint(footerText) : ""));
  return lines;
}

export function buildMushCardFrame(context, rows = []) {
  const lines = buildCardLines(context, rows);
  return {
    text: `${lines.join("\n")}\n\n`,
    blockHeight: lines.length + 1,
    cursorUpLines: lines.length + 1,
  };
}

export function printMushCard(context, rows = []) {
  process.stdout.write(buildMushCardFrame(context, rows).text);
}
