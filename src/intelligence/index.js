import fs from "node:fs/promises";
import path from "node:path";

import { buildRepoMapResult } from "./repo-map.js";

const REPO_INTELLIGENCE_PATTERNS = [
  /repo\s*map/i,
  /repository\s+map/i,
  /repo\s+structure/i,
  /repository\s+structure/i,
  /what\s+is\s+this\s+project/i,
  /what\s+project\s+is\s+this/i,
  /describe\s+this\s+project/i,
];

function wrapRepoMap(text) {
  if (!text?.trim()) return "";

  return [
    "Repository map context:",
    "This is a generated high-level map of the current repository.",
    "Use this map before calling tools for high-level structure questions.",
    "If the user asks about repository structure, modules, files, symbols, or 'the repo map', answer from this map first.",
    "Only call filesystem tools if the map is clearly insufficient for the user's request.",
    "",
    text.trim(),
  ].join("\n");
}

function normalizePrompt(prompt) {
  return String(prompt ?? "").trim();
}

function isFileLine(line) {
  return line
    && !line.startsWith("  ")
    && line !== "Repository map:"
    && line !== "Repository map context:"
    && !line.startsWith("This is a generated")
    && !line.startsWith("Use this map before")
    && !line.startsWith("If the user asks")
    && !line.startsWith("Only call filesystem")
    && !line.startsWith("Answer high-level")
    && !line.startsWith("Prefer concise");
}

function extractRepoMapEntries(repoMapText) {
  const lines = String(repoMapText ?? "").split("\n");
  const entries = [];
  let current = null;

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (!line.trim()) continue;

    if (isFileLine(line)) {
      current = {
        file: line.trim(),
        symbols: [],
      };
      entries.push(current);
      continue;
    }

    if (line.startsWith("  ") && current) {
      current.symbols.push(line.trim());
    }
  }

  return entries;
}

function groupRepoAreas(entries) {
  const areaDefinitions = [
    ["config", /^src\/config\//, "configuration, state, and prompt stack"],
    ["providers", /^src\/providers\//, "LLM provider integrations"],
    ["ui", /^src\/ui\//, "terminal UI, setup, and chat scenes"],
    ["commands", /^src\/commands\//, "slash commands and runtime overrides"],
    ["history", /^src\/history\//, "session history, storage, and usage metrics"],
    ["orchestrator", /^src\/orchestrator\//, "task routing and worker orchestration"],
    ["intelligence", /^src\/intelligence\//, "AST parsing and repository map generation"],
    ["tools", /^src\/tools\//, "tool loop and bash/write_file execution"],
  ];

  return areaDefinitions
    .map(([key, pattern, description]) => ({
      key,
      description,
      files: entries.filter((entry) => pattern.test(entry.file)),
    }))
    .filter((entry) => entry.files.length > 0)
    .slice(0, 6);
}

function topFileEntries(entries, maxFiles = 6) {
  return entries
    .slice(0, maxFiles)
    .map((entry) => ({
      file: entry.file,
      symbols: entry.symbols
        .filter((symbol) => !symbol.startsWith("import "))
        .slice(0, 4),
    }));
}

async function readProjectMetadata(cwd) {
  try {
    const packageJsonPath = path.join(cwd, "package.json");
    const packageJson = JSON.parse(await fs.readFile(packageJsonPath, "utf8"));
    return {
      name: packageJson.name ?? path.basename(cwd),
      isCli: Boolean(packageJson.bin),
      isEsm: packageJson.type === "module",
    };
  } catch {
    return {
      name: path.basename(cwd),
      isCli: false,
      isEsm: false,
    };
  }
}

function buildProjectLead(metadata, entries) {
  const hasProviders = entries.some((entry) => entry.file.startsWith("src/providers/"));
  const hasTerminalUi = entries.some((entry) => entry.file.startsWith("src/ui/"));
  const hasOrchestrator = entries.some((entry) => entry.file.startsWith("src/orchestrator/"));
  const hasIntelligence = entries.some((entry) => entry.file.startsWith("src/intelligence/"));

  const parts = [];
  if (metadata.isEsm) parts.push("Node.js ESM");
  if (metadata.isCli || hasTerminalUi) parts.push("CLI");
  if (hasProviders) parts.push("for working with LLM providers");
  if (hasOrchestrator) parts.push("with orchestrator-based routing");
  if (hasIntelligence) parts.push("and a built-in code-intelligence repository map");

  const descriptor = parts.length > 0
    ? parts.join(" ")
    : "a codebase-oriented project";

  return `This is the ${metadata.name} project: ${descriptor}.`;
}

export function isRepoIntelligencePrompt(prompt) {
  const normalized = normalizePrompt(prompt);
  return REPO_INTELLIGENCE_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function buildRepoMapAnswer(repoMapText, prompt, metadata = {}) {
  if (!isRepoIntelligencePrompt(prompt)) return "";

  const entries = extractRepoMapEntries(repoMapText);
  if (entries.length === 0) return "";

  const projectLead = buildProjectLead(
    {
      name: metadata.name ?? path.basename(metadata.cwd ?? process.cwd()),
      isCli: metadata.isCli ?? false,
      isEsm: metadata.isEsm ?? false,
    },
    entries,
  );
  const areas = groupRepoAreas(entries);
  const topFiles = topFileEntries(entries);

  const lines = [projectLead, ""];

  if (areas.length > 0) {
    lines.push("Key areas:");
    for (const area of areas) {
      lines.push(`- \`${area.files[0].file.split("/").slice(0, 2).join("/")}/\` - ${area.description}`);
    }
    lines.push("");
  }

  lines.push("Quick map:");
  for (const entry of topFiles) {
    lines.push(`\`${entry.file}\``);
    for (const symbol of entry.symbols) {
      lines.push(`- ${symbol}`);
    }
  }

  return lines.join("\n").trim();
}

export async function getRepoMapText(cwd, options = {}) {
  try {
    const result = await buildRepoMapResult(cwd, options);
    return wrapRepoMap(result.text);
  } catch {
    return "";
  }
}

export async function getRepoMapResult(cwd, options = {}) {
  try {
    const result = await buildRepoMapResult(cwd, options);
    return {
      text: wrapRepoMap(result.text),
      stats: result.stats,
      blocks: result.blocks,
    };
  } catch {
    return {
      text: "",
      stats: {
        mode: options.mode === "compact" ? "compact" : "dense",
        files: 0,
        symbols: 0,
        exportedSymbols: 0,
        internalSymbols: 0,
      },
      blocks: [],
    };
  }
}

export async function buildRepoMapAnswerForPrompt(cwd, repoMapText, prompt) {
  const metadata = await readProjectMetadata(cwd);
  return buildRepoMapAnswer(repoMapText, prompt, {
    cwd,
    ...metadata,
  });
}
