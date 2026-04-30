// ─── Terminal markdown renderer ───────────────────────────────────────────────
// Lightweight markdown-to-ANSI renderer for CLI output.
// Handles: fenced code blocks (with language-aware highlighting), bold,
// inline code, unordered lists, and horizontal rules. No external deps.

import chalk from "chalk";
import { wrapText } from "./layout.js";

// ─── Syntax highlighting (keyword-based, no AST) ─────────────────────────────

const KEYWORDS_BY_LANG = {
  javascript: new Set([
    "async", "await", "break", "case", "catch", "class", "const", "continue",
    "debugger", "default", "delete", "do", "else", "export", "extends",
    "false", "finally", "for", "from", "function", "if", "import", "in",
    "instanceof", "let", "new", "null", "of", "return", "static", "super",
    "switch", "this", "throw", "true", "try", "typeof", "undefined", "var",
    "void", "while", "with", "yield",
  ]),
  typescript: null, // shares javascript
  python: new Set([
    "and", "as", "assert", "async", "await", "break", "class", "continue",
    "def", "del", "elif", "else", "except", "False", "finally", "for",
    "from", "global", "if", "import", "in", "is", "lambda", "None",
    "nonlocal", "not", "or", "pass", "raise", "return", "True", "try",
    "while", "with", "yield",
  ]),
  bash: new Set([
    "if", "then", "else", "elif", "fi", "for", "while", "do", "done",
    "case", "esac", "in", "function", "select", "until", "return", "exit",
    "export", "local", "readonly", "declare", "unset", "set", "shift",
    "true", "false",
  ]),
  sh: null, // shares bash
  zsh: null, // shares bash
  shell: null, // shares bash
  go: new Set([
    "break", "case", "chan", "const", "continue", "default", "defer",
    "else", "fallthrough", "for", "func", "go", "goto", "if", "import",
    "interface", "map", "package", "range", "return", "select", "struct",
    "switch", "type", "var", "nil", "true", "false",
  ]),
  rust: new Set([
    "as", "async", "await", "break", "const", "continue", "crate", "dyn",
    "else", "enum", "extern", "false", "fn", "for", "if", "impl", "in",
    "let", "loop", "match", "mod", "move", "mut", "pub", "ref", "return",
    "self", "Self", "static", "struct", "super", "trait", "true", "type",
    "unsafe", "use", "where", "while",
  ]),
  json: new Set(["true", "false", "null"]),
  toml: new Set(["true", "false"]),
  yaml: new Set(["true", "false", "null", "yes", "no"]),
  sql: new Set([
    "select", "from", "where", "and", "or", "not", "in", "is", "null",
    "insert", "into", "values", "update", "set", "delete", "create",
    "table", "drop", "alter", "index", "join", "left", "right", "inner",
    "outer", "on", "group", "by", "order", "asc", "desc", "limit",
    "offset", "having", "union", "all", "as", "distinct", "exists",
    "between", "like", "case", "when", "then", "else", "end", "true",
    "false", "begin", "commit", "rollback",
  ]),
};

// Language aliases
KEYWORDS_BY_LANG.js = KEYWORDS_BY_LANG.javascript;
KEYWORDS_BY_LANG.ts = KEYWORDS_BY_LANG.javascript;
KEYWORDS_BY_LANG.jsx = KEYWORDS_BY_LANG.javascript;
KEYWORDS_BY_LANG.tsx = KEYWORDS_BY_LANG.javascript;
KEYWORDS_BY_LANG.mjs = KEYWORDS_BY_LANG.javascript;
KEYWORDS_BY_LANG.cjs = KEYWORDS_BY_LANG.javascript;
KEYWORDS_BY_LANG.py = KEYWORDS_BY_LANG.python;

function resolveKeywords(lang) {
  if (!lang) return null;
  const lower = lang.toLowerCase();
  const entry = KEYWORDS_BY_LANG[lower];
  if (entry) return entry;
  // Follow alias chain: typescript → javascript, sh → bash, etc.
  if (lower === "typescript" || lower === "ts") return KEYWORDS_BY_LANG.javascript;
  if (lower === "sh" || lower === "zsh" || lower === "shell") return KEYWORDS_BY_LANG.bash;
  return null;
}

// ─── Token-level syntax highlighter ──────────────────────────────────────────

const SHELL_BUILTINS = new Set([
  "cd", "echo", "printf", "read", "test", "source", "eval", "exec",
  "trap", "wait", "kill", "jobs", "bg", "fg", "umask", "getopts",
]);

const SHELL_COMMANDS = new Set([
  "git", "npm", "npx", "node", "python", "pip", "cargo", "go", "make",
  "docker", "kubectl", "curl", "wget", "cat", "ls", "cp", "mv", "rm",
  "mkdir", "rmdir", "find", "grep", "sed", "awk", "sort", "uniq",
  "head", "tail", "wc", "diff", "tar", "zip", "unzip", "ssh", "scp",
  "chmod", "chown", "sudo", "apt", "brew", "yum", "dnf",
]);

function highlightCodeLine(line, lang) {
  const keywords = resolveKeywords(lang);
  const isBashLike = ["bash", "sh", "zsh", "shell"].includes(lang?.toLowerCase());

  // Handle comments
  const commentMatch = isBashLike
    ? line.match(/^(.*?)(#.*)$/)
    : line.match(/^(.*?)(\/\/.*)$/);

  let codePart = line;
  let commentPart = "";
  if (commentMatch && !isInsideString(line, commentMatch.index + commentMatch[1].length)) {
    codePart = commentMatch[1];
    commentPart = chalk.dim.italic(commentMatch[2]);
  }

  if (!keywords && !isBashLike) {
    return codePart + commentPart;
  }

  // Tokenize and highlight
  const highlighted = codePart.replace(
    // Match strings, numbers, and word tokens
    /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`|\b\d+(?:\.\d+)?\b|[a-zA-Z_$][\w$]*|--?[\w-]+)/g,
    (token) => {
      // Strings
      if (/^["'`]/.test(token)) {
        return chalk.green(token);
      }
      // Numbers
      if (/^\d/.test(token)) {
        return chalk.yellow(token);
      }
      // CLI flags (--flag, -f)
      if (/^--?[a-zA-Z]/.test(token)) {
        return chalk.cyan(token);
      }
      // Keywords
      if (keywords?.has(token)) {
        return chalk.magenta.bold(token);
      }
      // Shell builtins and known commands
      if (isBashLike) {
        if (SHELL_BUILTINS.has(token)) return chalk.yellow.bold(token);
        if (SHELL_COMMANDS.has(token)) return chalk.cyan.bold(token);
      }
      return token;
    },
  );

  return highlighted + commentPart;
}

function isInsideString(line, index) {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < index; i++) {
    if (line[i] === "'" && !inDouble) inSingle = !inSingle;
    if (line[i] === '"' && !inSingle) inDouble = !inDouble;
  }
  return inSingle || inDouble;
}

// ─── Inline markdown formatting ──────────────────────────────────────────────

function formatInlineMarkdown(line) {
  // Bold+Italic: ***text*** or ___text___
  let result = line.replace(/(\*{3}|_{3})(?!\s)([\s\S]*?\S)\1/g, (_, _m, text) =>
    chalk.bold.italic(text),
  );
  // Bold: **text** or __text__
  result = result.replace(/(\*{2}|_{2})(?!\s)([\s\S]*?\S)\1/g, (_, _m, text) =>
    chalk.bold(text),
  );
  // Italic: *text* or _text_ (but not inside words for _)
  result = result.replace(/(?<![\\*\w])\*(?!\s)([^\n*]+?)(?<!\s)\*(?![*\w])/g, (_, text) =>
    chalk.italic(text),
  );
  // Inline code: `text` — render with distinct styling, no background
  result = result.replace(/`([^`\n]+?)`/g, (_, text) =>
    chalk.hex("#93c5fd")(text),
  );
  return result;
}

// ─── Block-level markdown parser ─────────────────────────────────────────────

/**
 * Render a markdown string into ANSI-colored lines for terminal display.
 * Returns an array of styled strings (one per visual line).
 *
 * Handles:
 * - Fenced code blocks (```lang) with syntax highlighting
 * - **bold**, *italic*, `inline code`
 * - Unordered lists (- item, * item)
 * - Horizontal rules (---, ***)
 * - Headers (# H1, ## H2, etc.)
 */
export function renderMarkdown(text, width) {
  const lines = text.split("\n");
  const output = [];
  let inCodeBlock = false;
  let codeLang = null;
  const codeBuffer = [];

  // Wrap plain text to width, then apply inline markdown formatting.
  function wrapAndFormat(rawLine, maxWidth, continuationIndent = "") {
    const wrapped = wrapText(rawLine, maxWidth, continuationIndent);
    for (const wl of wrapped) {
      output.push(formatInlineMarkdown(wl));
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // ─── Code fence open/close ───
    const fenceMatch = line.match(/^(`{3,})([\w.-]*)\s*$/);

    if (fenceMatch && !inCodeBlock) {
      inCodeBlock = true;
      codeLang = fenceMatch[2] || null;
      codeBuffer.length = 0;
      continue;
    }

    if (fenceMatch && inCodeBlock) {
      flushCodeBlock(codeBuffer, codeLang, width, output);
      inCodeBlock = false;
      codeLang = null;
      codeBuffer.length = 0;
      continue;
    }

    if (inCodeBlock) {
      codeBuffer.push(line);
      continue;
    }

    // ─── Horizontal rule ───
    if (/^(\s*[-*_]\s*){3,}\s*$/.test(line)) {
      const ruleWidth = Math.min(width, 40);
      output.push(chalk.dim("─".repeat(ruleWidth)));
      continue;
    }

    // ─── Headers ───
    const headerMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headerMatch) {
      const level = headerMatch[1].length;
      const wrapped = wrapText(headerMatch[2], width, "");
      for (const wl of wrapped) {
        const formatted = formatInlineMarkdown(wl);
        if (level === 1) {
          output.push(chalk.bold.underline(formatted));
        } else if (level === 2) {
          output.push(chalk.bold(formatted));
        } else {
          output.push(chalk.bold.dim(formatted));
        }
      }
      continue;
    }

    // ─── Unordered list ───
    const listMatch = line.match(/^(\s*)([-*+])\s+(.*)$/);
    if (listMatch) {
      const indent = listMatch[1];
      const prefix = `${indent}${chalk.cyan("•")} `;
      const plainPrefix = `${indent}• `;
      const contIndent = " ".repeat(plainPrefix.length);
      const wrapped = wrapText(listMatch[3], width - plainPrefix.length, "");
      for (let j = 0; j < wrapped.length; j++) {
        const formatted = formatInlineMarkdown(wrapped[j]);
        output.push(j === 0 ? `${prefix}${formatted}` : `${contIndent}${formatted}`);
      }
      continue;
    }

    // ─── Ordered list ───
    const orderedMatch = line.match(/^(\s*)(\d+)\.\s+(.*)$/);
    if (orderedMatch) {
      const indent = orderedMatch[1];
      const num = orderedMatch[2];
      const prefix = `${indent}${chalk.cyan(num + ".")} `;
      const plainPrefix = `${indent}${num}. `;
      const contIndent = " ".repeat(plainPrefix.length);
      const wrapped = wrapText(orderedMatch[3], width - plainPrefix.length, "");
      for (let j = 0; j < wrapped.length; j++) {
        const formatted = formatInlineMarkdown(wrapped[j]);
        output.push(j === 0 ? `${prefix}${formatted}` : `${contIndent}${formatted}`);
      }
      continue;
    }

    // ─── Regular text with inline formatting ───
    wrapAndFormat(line, width);
  }

  // Handle unclosed code block
  if (inCodeBlock && codeBuffer.length > 0) {
    flushCodeBlock(codeBuffer, codeLang, width, output);
  }

  return output;
}

// ─── Code block rendering ────────────────────────────────────────────────────

function flushCodeBlock(buffer, lang, width, output) {
  const codeWidth = Math.max(20, Math.min(width, (process.stdout.columns || 80) - 6));
  const innerWidth = Math.max(0, codeWidth - 4);
  const border = chalk.dim;

  // Top border with language label (rounded corners to match input box)
  if (lang) {
    const label = chalk.dim.italic(` ${lang} `);
    const labelLen = lang.length + 2;
    const ruleLeft = Math.max(0, codeWidth - 2 - labelLen - 1);
    output.push(border("╭" + "─".repeat(ruleLeft)) + label + border("─╮"));
  } else {
    output.push(border("╭" + "─".repeat(Math.max(0, codeWidth - 2)) + "╮"));
  }

  for (const codeLine of buffer) {
    const highlighted = highlightCodeLine(codeLine, lang);
    const visLen = stripAnsiLength(highlighted);
    const pad = Math.max(0, innerWidth - visLen);
    output.push(border("│ ") + highlighted + " ".repeat(pad) + border(" │"));
  }

  // Bottom border (rounded)
  output.push(border("╰" + "─".repeat(Math.max(0, codeWidth - 2)) + "╯"));
}

function stripAnsiLength(str) {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "").length;
}

