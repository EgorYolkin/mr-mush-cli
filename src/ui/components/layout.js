// ─── Layout utilities ─────────────────────────────────────────────────────────
// Pure functions — no side effects, no imports.
// All width / text measurement helpers live here. Other modules must import
// from this file to avoid duplicate, inconsistent implementations.

/**
 * Strip ALL ANSI escape sequences (SGR, CSI, OSC) to get raw text.
 * Covers: colors, bold/dim, cursor movement, hyperlinks, etc.
 */
export function stripAnsi(value) {
  // eslint-disable-next-line no-control-regex
  return String(value).replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
}

/**
 * Return the visual width of a single character in a terminal.
 * CJK ideographs, fullwidth forms, and emoji occupy 2 columns.
 */
export function charWidth(char) {
  const codePoint = char.codePointAt(0);
  if (!codePoint) return 0;
  if (codePoint === 0) return 0;
  if (codePoint < 32 || (codePoint >= 0x7f && codePoint < 0xa0)) return 0;
  // Combining diacritical marks.
  if (codePoint >= 0x300 && codePoint <= 0x36f) return 0;
  if (
    (codePoint >= 0x1100 && codePoint <= 0x115f) ||
    (codePoint >= 0x2329 && codePoint <= 0x232a) ||
    (codePoint >= 0x2e80 && codePoint <= 0xa4cf) ||
    (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0xfe10 && codePoint <= 0xfe19) ||
    (codePoint >= 0xfe30 && codePoint <= 0xfe6f) ||
    (codePoint >= 0xff00 && codePoint <= 0xff60) ||
    (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
    (codePoint >= 0x1f300 && codePoint <= 0x1faff)
  ) {
    return 2;
  }
  return 1;
}

/**
 * Get the visible (terminal column) width of a string, stripping ANSI
 * codes and accounting for double-width CJK / emoji characters.
 */
export function visibleLength(value) {
  return [...stripAnsi(value)].reduce(
    (width, char) => width + charWidth(char),
    0,
  );
}

/**
 * Slice a string to fit within `width` terminal columns, respecting
 * double-width characters. ANSI codes are treated as zero-width.
 */
export function sliceToWidth(value, width) {
  const stripped = stripAnsi(value);
  let currentWidth = 0;
  let result = "";

  for (const char of stripped) {
    const nextWidth = charWidth(char);
    if (currentWidth + nextWidth > width) break;
    result += char;
    currentWidth += nextWidth;
  }

  return result;
}

/**
 * Canonical frame width used by all components (input box, mush card, etc.).
 * Leaves a 4-column margin for box-drawing borders and padding.
 */
export function frameWidth() {
  const columns = process.stdout.columns || 96;
  return Math.max(6, columns - 4);
}

/**
 * Word-wrap plain text to fit within `width` columns.
 */
export function wrapText(text, width, indent) {
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

/**
 * Fit text into exactly `width` terminal columns:
 * - Pad with spaces if shorter.
 * - Truncate with "…" if longer.
 * CJK-aware: respects double-width characters.
 */
export function fitText(value, width) {
  const length = visibleLength(value);
  if (length <= width) return value + " ".repeat(width - length);
  if (width <= 1) return " ".repeat(width);
  const ellipsis = "…";
  const ellipsisWidth = visibleLength(ellipsis);
  const truncated = sliceToWidth(value, width - ellipsisWidth);
  const truncatedWidth = visibleLength(truncated);
  const pad = Math.max(0, width - truncatedWidth - ellipsisWidth);
  return `${truncated}${ellipsis}${" ".repeat(pad)}`;
}

