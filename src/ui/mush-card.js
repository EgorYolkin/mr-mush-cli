import chalk from "chalk";

function color(theme, name, fallback = chalk.white) {
  return theme.colors?.[name] ?? fallback;
}

function frameWidth() {
  const columns = process.stdout.columns || 96;
  return Math.max(6, Math.min(columns - 1, 92));
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

function leadingWhitespace(value) {
  const match = value.match(/^ */);
  return match ? match[0].length : 0;
}

function centerBlock(lines, width) {
  const fittedLines = lines.map((line) => fitText(line, width));
  const blockWidth = Math.max(...fittedLines.map((line) => visibleLength(line)));
  const blockLeft = Math.max(0, Math.floor((width - blockWidth) / 2));

  return fittedLines.map((line) => {
    const paddedLine = line + " ".repeat(blockWidth - visibleLength(line));
    return `${" ".repeat(blockLeft)}${paddedLine}${" ".repeat(width - blockLeft - blockWidth)}`;
  });
}

function shiftBlockLeft(lines, targetOffset) {
  const currentOffset = Math.min(...lines.map((line) => leadingWhitespace(line)));
  const shift = Math.max(0, currentOffset - Math.max(0, targetOffset));

  return lines.map((line) => {
    const removable = Math.min(leadingWhitespace(line), shift);
    const shifted = line.slice(removable);
    return shifted + " ".repeat(Math.max(0, line.length - visibleLength(shifted)));
  });
}

function alignTextToOffset(value, width, offset) {
  const availableWidth = Math.max(1, width - offset);
  const fitted = fitText(value, availableWidth);
  return `${" ".repeat(Math.max(0, offset))}${fitted}${" ".repeat(Math.max(0, width - offset - visibleLength(fitted)))}`;
}

function frameLine(theme, content) {
  const frame = theme.symbols?.frame ?? {};
  const vertical = frame.vertical ?? "│";
  const border = color(theme, "border", chalk.dim);
  return `${border(vertical)}${content}${border(vertical)}`;
}

function buildCardLines(context, rows = []) {
  const theme = context.ui?.theme ?? {};
  const frame = theme.symbols?.frame ?? {};
  const horizontal = frame.horizontal ?? "─";
  const topLeft = frame.topLeft ?? "╭";
  const topRight = frame.topRight ?? "╮";
  const bottomLeft = frame.bottomLeft ?? "╰";
  const bottomRight = frame.bottomRight ?? "╯";
  const border = color(theme, "border", chalk.dim);
  const accent = color(theme, "accent", chalk.magenta);
  const width = frameWidth();
  const innerWidth = width - 2;
  const titleText = ` ${theme.layout?.splashTitle ?? "MR. MUSH"} `;
  const topRuleWidth = width - titleText.length - 2;
  const splash = theme.layout?.splash ?? [];
  const artRows = shiftBlockLeft(centerBlock(splash, innerWidth), 2);
  const artLeftOffset = Math.min(...artRows.map((line) => leadingWhitespace(line)));

  const lines = [
    border(topLeft + horizontal.repeat(3)) +
      accent(titleText) +
      border(horizontal.repeat(Math.max(0, topRuleWidth - 3)) + topRight),
  ];
  const normalizedRows = rows.map((row) => ({
    paint: row.paint ?? color(theme, "muted", chalk.dim),
    text: alignTextToOffset(row.text, innerWidth, artLeftOffset),
  }));

  const cardRows = [
    { text: " ".repeat(innerWidth) },
    ...artRows.map((line) => ({ text: line, paint: accent })),
    { text: " ".repeat(innerWidth) },
    ...normalizedRows,
  ];

  for (const row of cardRows) {
    lines.push(frameLine(theme, row.paint ? row.paint(row.text) : row.text));
  }

  lines.push(border(bottomLeft + horizontal.repeat(width - 2) + bottomRight));
  return lines;
}

export function printMushCard(context, rows = []) {
  process.stdout.write(buildCardLines(context, rows).join("\n") + "\n\n");
}
