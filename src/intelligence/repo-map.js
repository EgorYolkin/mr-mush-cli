import fs from "node:fs/promises";
import path from "node:path";

import { parseFileSymbols } from "./ast-parser.js";
import { SUPPORTED_EXTENSIONS } from "./languages.js";

const DEFAULT_MAX_FILES = 500;

function estimateTokens(text) {
  return Math.ceil(text.length / 4);
}

function isDeniedPath(relativePath, deniedPaths) {
  return deniedPaths.some((denied) => (
    relativePath === denied || relativePath.startsWith(`${denied}/`)
  ));
}

function fileWeight(relativePath) {
  const weights = [
    [/^src\/config\/loader\.js$/, 45],
    [/^src\/config\/schema\.js$/, 44],
    [/^src\/router\.js$/, 42],
    [/^src\/ui\/scenes\/chat\.js$/, 42],
    [/^src\/providers\/index\.js$/, 40],
    [/^src\/tools\/orchestrator\.js$/, 39],
    [/^src\/orchestrator\//, 36],
    [/^src\/intelligence\//, 34],
    [/^src\/providers\//, 30],
    [/^src\/ui\/scenes\//, 28],
    [/^src\/commands\//, 26],
    [/^src\/history\//, 22],
    [/^src\/config\//, 20],
    [/^src\//, 8],
  ];

  for (const [pattern, weight] of weights) {
    if (pattern.test(relativePath)) return weight;
  }
  return 0;
}

function symbolWeight(symbol) {
  let weight = 0;
  if (symbol.exported) weight += 30;
  if (symbol.kind === "function") weight += 12;
  if (symbol.kind === "class") weight += 11;
  if (symbol.kind === "variable") weight += 5;
  return weight;
}

function extractParameterList(signature) {
  const openIndex = signature.indexOf("(");
  if (openIndex === -1) return "";

  let depth = 0;
  let quote = null;
  for (let index = openIndex; index < signature.length; index += 1) {
    const char = signature[index];
    const prev = signature[index - 1];

    if (quote) {
      if (char === quote && prev !== "\\") {
        quote = null;
      }
      continue;
    }

    if (char === "\"" || char === "'" || char === "`") {
      quote = char;
      continue;
    }

    if (char === "(") {
      depth += 1;
      continue;
    }

    if (char === ")") {
      depth -= 1;
      if (depth === 0) {
        return signature.slice(openIndex + 1, index);
      }
    }
  }

  return "";
}

function splitTopLevelParams(rawParams) {
  const parts = [];
  let current = "";
  let quote = null;
  let parenDepth = 0;
  let braceDepth = 0;
  let bracketDepth = 0;

  for (let index = 0; index < rawParams.length; index += 1) {
    const char = rawParams[index];
    const prev = rawParams[index - 1];

    if (quote) {
      current += char;
      if (char === quote && prev !== "\\") {
        quote = null;
      }
      continue;
    }

    if (char === "\"" || char === "'" || char === "`") {
      quote = char;
      current += char;
      continue;
    }

    if (char === "(") parenDepth += 1;
    if (char === ")") parenDepth -= 1;
    if (char === "{") braceDepth += 1;
    if (char === "}") braceDepth -= 1;
    if (char === "[") bracketDepth += 1;
    if (char === "]") bracketDepth -= 1;

    if (char === "," && parenDepth === 0 && braceDepth === 0 && bracketDepth === 0) {
      if (current.trim()) parts.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  if (current.trim()) parts.push(current.trim());
  return parts;
}

function formatDestructuredParam(param) {
  const trimmed = param.trim();
  if (trimmed.startsWith("{")) {
    const inner = trimmed.slice(1, trimmed.lastIndexOf("}"));
    const keys = splitTopLevelParams(inner)
      .map((part) => part.replace(/\s*=\s*.+$/, "").trim())
      .map((part) => part.split(":")[0]?.trim() ?? part)
      .filter(Boolean)
      .slice(0, 3);
    const suffix = splitTopLevelParams(inner).length > keys.length ? ", ..." : "";
    return `{ ${keys.join(", ")}${suffix} }`;
  }

  if (trimmed.startsWith("[")) {
    return "[...]";
  }

  return trimmed;
}

function formatFunctionSignature(signature, name) {
  const rawParams = extractParameterList(signature).trim();
  if (!rawParams) return `${name}()`;

  const rawParts = splitTopLevelParams(rawParams);
  const params = rawParts
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 3)
    .map((part) => {
      const normalized = formatDestructuredParam(part)
        .replace(/\s*=\s*.+$/, "")
        .replace(/:\s*.+$/, "")
        .replace(/^\.\.\./, "...");
      return normalized.trim();
    })
    .filter(Boolean);

  const suffix = rawParts.length > params.length ? ", ..." : "";
  return `${name}(${params.join(", ")}${suffix})`;
}

function formatSymbol(symbol, mode) {
  const prefixMap = {
    function: "fn",
    class: "class",
    variable: "const",
  };
  const prefix = prefixMap[symbol.kind] ?? symbol.kind;
  const suffix = symbol.exported ? " [export]" : "";

  if (symbol.kind === "function") {
    const name = mode === "dense"
      ? formatFunctionSignature(symbol.signature, symbol.name)
      : `${symbol.name}()`;
    return `  ${prefix} ${name}${suffix}`;
  }

  return `  ${prefix} ${symbol.name}${suffix}`;
}

function fitBlock(relativePath, symbols, currentText, tokenBudget, mode) {
  const lines = [relativePath];
  for (const symbol of symbols) {
    lines.push(formatSymbol(symbol, mode));
    const candidateBlock = lines.join("\n");
    const candidateText = currentText
      ? `${currentText}\n\n${candidateBlock}`
      : candidateBlock;
    if (estimateTokens(candidateText) > tokenBudget) {
      lines.pop();
      break;
    }
  }
  return lines.length > 1 ? lines.join("\n") : "";
}

async function collectFiles(rootDir, options, currentDir = rootDir, bucket = []) {
  if (bucket.length >= options.maxFiles) return bucket;

  const entries = await fs.readdir(currentDir, { withFileTypes: true });
  const sortedEntries = entries.sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of sortedEntries) {
    if (bucket.length >= options.maxFiles) break;

    const fullPath = path.join(currentDir, entry.name);
    const relativePath = path.relative(rootDir, fullPath).split(path.sep).join("/");
    if (!relativePath) continue;
    if (isDeniedPath(relativePath, options.deniedPaths)) continue;

    if (entry.isDirectory()) {
      await collectFiles(rootDir, options, fullPath, bucket);
      continue;
    }

    if (!SUPPORTED_EXTENSIONS.includes(path.extname(entry.name).toLowerCase())) continue;
    bucket.push(fullPath);
  }

  return bucket;
}

function normalizeOptions(options = {}) {
  return {
    tokenBudget: options.tokenBudget ?? 2000,
    deniedPaths: options.deniedPaths ?? [],
    maxFiles: options.maxFiles ?? DEFAULT_MAX_FILES,
    mode: options.mode === "compact" ? "compact" : "dense",
    maxSymbolsPerFile: options.maxSymbolsPerFile ?? null,
    includeInternalSymbols: options.includeInternalSymbols ?? true,
  };
}

function selectImportantSymbols(symbols, options) {
  const ordered = [...symbols]
    .filter((symbol) => symbol.kind !== "import")
    .sort((left, right) => symbolWeight(right) - symbolWeight(left) || left.line - right.line);

  const exported = ordered.filter((symbol) => symbol.exported);
  const internal = ordered.filter((symbol) => !symbol.exported);

  const defaultMax = options.mode === "dense" ? 6 : 3;
  const maxSymbols = options.maxSymbolsPerFile ?? defaultMax;
  const maxExported = Math.min(exported.length, Math.max(2, maxSymbols));
  const selected = exported.slice(0, maxExported);

  if (!options.includeInternalSymbols && selected.length === 0) {
    return [];
  }

  if (
    options.includeInternalSymbols
    && selected.length < maxSymbols
    && options.mode === "dense"
  ) {
    selected.push(...internal.slice(0, maxSymbols - selected.length));
  }

  if (selected.length === 0) {
    selected.push(...ordered.slice(0, Math.min(maxSymbols, options.mode === "dense" ? 4 : 2)));
  }

  return selected.slice(0, maxSymbols);
}

function computeStats(blocks, mode) {
  const files = blocks.length;
  const symbols = blocks.reduce((sum, block) => sum + block.symbols.length, 0);
  const exportedSymbols = blocks.reduce((sum, block) => (
    sum + block.symbols.filter((symbol) => symbol.exported).length
  ), 0);
  const internalSymbols = symbols - exportedSymbols;

  return {
    mode,
    files,
    symbols,
    exportedSymbols,
    internalSymbols,
  };
}

export async function buildRepoMapResult(rootDir, options = {}) {
  const normalizedOptions = normalizeOptions(options);
  const files = await collectFiles(rootDir, normalizedOptions);
  const blocks = [];

  for (const filePath of files) {
    const relativePath = path.relative(rootDir, filePath).split(path.sep).join("/");
    const parsed = await parseFileSymbols(filePath);
    if (!parsed.symbols.length) continue;

    const importantSymbols = selectImportantSymbols(parsed.symbols, normalizedOptions);
    if (importantSymbols.length === 0) continue;

    blocks.push({
      relativePath,
      symbols: importantSymbols,
      weight: fileWeight(relativePath) + importantSymbols.reduce((sum, symbol) => sum + symbolWeight(symbol), 0),
    });
  }

  const orderedBlocks = blocks.sort((left, right) => (
    right.weight - left.weight || left.relativePath.localeCompare(right.relativePath)
  ));

  let text = "Repository map:";
  const includedBlocks = [];
  for (const block of orderedBlocks) {
    const fittedBlock = fitBlock(
      block.relativePath,
      block.symbols,
      text,
      normalizedOptions.tokenBudget,
      normalizedOptions.mode,
    );
    if (!fittedBlock) continue;

    text = `${text}\n\n${fittedBlock}`;
    includedBlocks.push(block);
  }

  if (includedBlocks.length === 0) {
    return {
      text: "",
      stats: {
        mode: normalizedOptions.mode,
        files: 0,
        symbols: 0,
        exportedSymbols: 0,
        internalSymbols: 0,
      },
      blocks: [],
    };
  }

  return {
    text,
    stats: computeStats(includedBlocks, normalizedOptions.mode),
    blocks: includedBlocks,
  };
}

export async function buildRepoMap(rootDir, options = {}) {
  const result = await buildRepoMapResult(rootDir, options);
  return result.text;
}
