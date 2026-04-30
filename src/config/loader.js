import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import { getRepoMapResult } from "../intelligence/index.js";
import {
  builtInConfig,
  DEFAULT_STATUSBAR_TEMPLATE,
  flattenZodIssues,
  LEGACY_STATUSBAR_TEMPLATE,
  userConfigSchema,
} from "./schema.js";

const TOOLS_FILE_OPS_PROMPT_URL = new URL(
  "../prompts/tools-file-ops.md",
  import.meta.url,
);

const APP_DIR_NAME = ".mrmush";
const CONFIG_FILE_NAME = "config.toml";
const THEME_FILE_NAME = "theme.yaml";
const LEGACY_DEFAULT_SYSTEM_PROMPT = [
  "You are Mr. Mush.",
  "Be direct, precise, and pragmatic.",
  "Prefer concrete implementation details over generic advice.",
  "",
  "When you need to inspect the local project, request a tool call with exactly one fenced block:",
  "```agents-tool",
  '{"name":"bash","args":{"cmd":"git status --short"}}',
  "```",
  "Do not wrap tool calls in additional JSON or prose. After receiving a tool result, use it to answer the user.",
].join("\n");
const DEFAULT_SYSTEM_PROMPT = [
  "You are Mr. Mush.",
  "Be direct, precise, and pragmatic.",
  "Prefer concrete implementation details over generic advice.",
  "",
  "You have tool access to the local project when tools are enabled.",
  "If the bash tool is enabled, you can inspect files and directories in the working tree.",
  "Do not say that you cannot access the filesystem if file tools are available.",
  "If the write_file tool is enabled, you can create new files and overwrite existing files after approval.",
  "Do not tell the user to create files manually when write_file is available.",
  "",
  "When you need to inspect the local project, request a tool call with exactly one fenced block:",
  "```agents-tool",
  '{"name":"bash","args":{"cmd":"git status --short"}}',
  "```",
  "",
  "When you need to create or replace a file, request a tool call with exactly one fenced block:",
  "```agents-tool",
  '{"name":"write_file","args":{"path":"src/example.js","content":"export const value = 1;\\n"}}',
  "```",
  "Do not wrap tool calls in additional JSON or prose. After receiving a tool result, use it to answer the user.",
].join("\n");

const DEFAULT_PROFILE_PROMPT = [
  "Default profile:",
  "- Keep answers concise.",
  "- Explain tradeoffs when they affect implementation.",
].join("\n");

const DEFAULT_PROVIDER_PROMPTS = {
  openai: "Provider guidance: prefer Codex CLI compatible instructions.",
  anthropic: "Provider guidance: prefer Claude CLI compatible instructions.",
  google: "Provider guidance: prefer Gemini compatible instructions.",
  deepseek: "Provider guidance: prefer DeepSeek API compatible instructions.",
};

function mergeObjects(base, override) {
  if (override === undefined) return structuredClone(base);
  if (Array.isArray(base) || Array.isArray(override))
    return structuredClone(override);
  if (
    !base ||
    !override ||
    typeof base !== "object" ||
    typeof override !== "object"
  ) {
    return structuredClone(override);
  }

  const result = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const existing = result[key];
    result[key] =
      existing &&
      value &&
      typeof existing === "object" &&
      typeof value === "object" &&
      !Array.isArray(existing) &&
      !Array.isArray(value)
        ? mergeObjects(existing, value)
        : structuredClone(value);
  }
  return result;
}

function setAtPath(target, dottedPath, value) {
  const segments = dottedPath.split(".").filter(Boolean);
  if (segments.length === 0) throw new Error("Empty config path");

  let cursor = target;
  for (let i = 0; i < segments.length - 1; i += 1) {
    const segment = segments[i];
    const next = cursor[segment];
    if (!next || typeof next !== "object" || Array.isArray(next)) {
      cursor[segment] = {};
    }
    cursor = cursor[segment];
  }
  cursor[segments.at(-1)] = value;
  return target;
}

function applyEnvOverrides(config, env) {
  const result = structuredClone(config);

  if (env.MRMUSH_PROVIDER) result.active_provider = env.MRMUSH_PROVIDER;
  if (env.MRMUSH_MODEL) result.active_model = env.MRMUSH_MODEL;
  if (env.MRMUSH_PROFILE) result.active_profile = env.MRMUSH_PROFILE;
  if (env.MRMUSH_THINKING) {
    result.reasoning = {
      ...result.reasoning,
      default_effort: env.MRMUSH_THINKING,
    };
  }

  return result;
}

function migrateLegacyStatusbar(config) {
  const next = structuredClone(config);
  if (next.ui?.statusbar_prompt === LEGACY_STATUSBAR_TEMPLATE) {
    next.ui = {
      ...next.ui,
      statusbar_prompt: DEFAULT_STATUSBAR_TEMPLATE,
    };
  }
  return next;
}

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function hasGlobalConfig({
  cwd = process.cwd(),
  homeDir = os.homedir(),
} = {}) {
  const paths = getAppPaths(cwd, homeDir);
  return fileExists(paths.configFile);
}

async function readTomlFile(filePath) {
  if (!(await fileExists(filePath))) return null;
  const content = await fs.readFile(filePath, "utf8");
  const parsed = parseToml(content);
  const result = userConfigSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `Invalid config ${filePath}\n${flattenZodIssues(result.error).join("\n")}`,
    );
  }
  return result.data;
}

async function maybeReadText(filePath) {
  if (!(await fileExists(filePath))) return null;
  return fs.readFile(filePath, "utf8");
}

async function readBundledText(fileUrl) {
  return fs.readFile(fileUrl, "utf8");
}

async function ensurePromptFile(
  filePath,
  expectedContent,
  legacyContent = null,
) {
  const nextContent = `${expectedContent}\n`;
  if (!(await fileExists(filePath))) {
    await fs.writeFile(filePath, nextContent, "utf8");
    return;
  }

  const currentContent = await fs.readFile(filePath, "utf8");
  if (legacyContent && currentContent.trim() === legacyContent.trim()) {
    await fs.writeFile(filePath, nextContent, "utf8");
  }
}

async function findProjectFileUpwards(startDir, fileName, homeDir = os.homedir()) {
  const boundary = path.resolve(homeDir);
  let currentDir = path.resolve(startDir);
  while (true) {
    const candidate = path.join(currentDir, fileName);
    if (await fileExists(candidate)) return candidate;
    const parentDir = path.dirname(currentDir);
    // Stop at filesystem root or home directory boundary.
    if (parentDir === currentDir || currentDir === boundary) return null;
    currentDir = parentDir;
  }
}

export function getAppPaths(cwd = process.cwd(), homeDir = os.homedir()) {
  const rootDir = path.join(homeDir, APP_DIR_NAME);
  const projectDir = path.join(cwd, APP_DIR_NAME);
  const promptsDir = path.join(rootDir, "prompts");

  return {
    cwd,
    homeDir,
    rootDir,
    configFile: path.join(rootDir, CONFIG_FILE_NAME),
    themeFile: path.join(rootDir, THEME_FILE_NAME),
    projectDir,
    projectConfigFile: path.join(projectDir, CONFIG_FILE_NAME),
    projectThemeFile: path.join(projectDir, THEME_FILE_NAME),
    promptsDir,
    systemPromptFile: path.join(promptsDir, "system.md"),
    profilesDir: path.join(promptsDir, "profiles"),
    profilePromptFile: (profile) =>
      path.join(promptsDir, "profiles", `${profile}.md`),
    providerPromptsDir: path.join(promptsDir, "providers"),
    providerPromptFile: (providerId) =>
      path.join(promptsDir, "providers", `${providerId}.md`),
    stateDir: path.join(rootDir, "state"),
    stateFile: path.join(rootDir, "state", "state.json"),
    cacheDir: path.join(rootDir, "cache"),
    modelsCacheFile: path.join(rootDir, "cache", "models.json"),
    logsDir: path.join(rootDir, "logs"),
    logFile: path.join(rootDir, "logs", "cli.log"),
    backupsDir: path.join(rootDir, "backups"),
    projectPromptFile: path.join(projectDir, "prompts", "system.md"),
    historyDir: path.join(rootDir, "history"),
    historyIndexFile: path.join(rootDir, "history", "index.json"),
  };
}

export async function bootstrapConfig({
  cwd = process.cwd(),
  homeDir = os.homedir(),
  detectedProviders = [],
} = {}) {
  const paths = getAppPaths(cwd, homeDir);

  await Promise.all([
    ensureDir(paths.rootDir),
    ensureDir(paths.promptsDir),
    ensureDir(paths.profilesDir),
    ensureDir(paths.providerPromptsDir),
    ensureDir(paths.stateDir),
    ensureDir(paths.cacheDir),
    ensureDir(paths.logsDir),
    ensureDir(paths.backupsDir),
    ensureDir(paths.historyDir),
  ]);

  const defaultProvider =
    detectedProviders[0]?.id ?? builtInConfig.active_provider;
  const defaultModel =
    detectedProviders[0]?.defaultModel ?? builtInConfig.active_model;

  const config = mergeObjects(builtInConfig, {
    active_provider: defaultProvider,
    active_model: defaultModel,
    providers: {
      [defaultProvider]: {
        model: defaultModel,
      },
    },
  });

  if (!(await fileExists(paths.configFile))) {
    await fs.writeFile(paths.configFile, stringifyToml(config), "utf8");
  }
  await ensurePromptFile(
    paths.systemPromptFile,
    DEFAULT_SYSTEM_PROMPT,
    LEGACY_DEFAULT_SYSTEM_PROMPT,
  );
  if (!(await fileExists(paths.profilePromptFile("default")))) {
    await fs.writeFile(
      paths.profilePromptFile("default"),
      `${DEFAULT_PROFILE_PROMPT}\n`,
      "utf8",
    );
  }

  await Promise.all(
    Object.entries(DEFAULT_PROVIDER_PROMPTS).map(async ([providerId, text]) => {
      const filePath = paths.providerPromptFile(providerId);
      if (!(await fileExists(filePath))) {
        await fs.writeFile(filePath, `${text}\n`, "utf8");
      }
    }),
  );

  if (!(await fileExists(paths.stateFile))) {
    await fs.writeFile(
      paths.stateFile,
      JSON.stringify(
        {
          schemaVersion: 1,
          bootstrapCompletedAt: new Date().toISOString(),
          lastUsedProvider: defaultProvider,
          lastUsedModel: defaultModel,
          lastUsedProfile: config.active_profile,
        },
        null,
        2,
      ),
      "utf8",
    );
  }

  return paths;
}

export async function backupFile(filePath, paths = getAppPaths()) {
  if (!(await fileExists(filePath))) return null;
  await ensureDir(paths.backupsDir);
  const stamp = new Date().toISOString().replaceAll(":", "-");
  const target = path.join(
    paths.backupsDir,
    `${path.basename(filePath)}.${stamp}.bak`,
  );
  await fs.copyFile(filePath, target);
  return target;
}

/**
 * Prepare auth entries for serialization.
 * When the user selected "env" as the source, api_key is already undefined
 * and will be omitted from the TOML file. When the user explicitly entered
 * a key, it is preserved so the app can read it back on the next launch.
 */
function cleanAuth(auth) {
  if (!auth || typeof auth !== "object") return auth;
  const cleaned = {};
  for (const [provider, settings] of Object.entries(auth)) {
    if (settings && typeof settings === "object") {
      // Drop keys that are explicitly undefined so TOML doesn't get "api_key = "
      const entry = {};
      for (const [key, value] of Object.entries(settings)) {
        if (value !== undefined) {
          entry[key] = value;
        }
      }
      cleaned[provider] = entry;
    } else {
      cleaned[provider] = settings;
    }
  }
  return cleaned;
}

function toUserConfig(config) {
  return {
    schema_version: config.schema_version,
    active_provider: config.active_provider ?? config.activeProvider,
    active_model: config.active_model ?? config.activeModel,
    active_profile: config.active_profile ?? config.activeProfile,
    ui: config.ui,
    reasoning: config.reasoning,
    auth: cleanAuth(config.auth),
    cache: config.cache,
    orchestrator: config.orchestrator,
    intelligence: config.intelligence,
    tools: config.tools,
    providers: config.providers,
    prompts: config.prompts,
  };
}

export async function saveConfig(config, paths = getAppPaths()) {
  const validated = userConfigSchema.parse(toUserConfig(config));
  await backupFile(paths.configFile, paths);
  await ensureDir(paths.rootDir);
  await fs.writeFile(paths.configFile, stringifyToml(validated), "utf8");
  return validated;
}

export async function saveConfigPatch(
  dottedPath,
  value,
  { scope = "global", cwd = process.cwd(), homeDir = os.homedir() } = {},
) {
  const paths = getAppPaths(cwd, homeDir);
  const filePath =
    scope === "project" ? paths.projectConfigFile : paths.configFile;
  const current = (await readTomlFile(filePath)) ?? {};
  const patched = setAtPath(structuredClone(current), dottedPath, value);
  const validated = userConfigSchema.parse(
    mergeObjects(builtInConfig, patched),
  );

  await ensureDir(path.dirname(filePath));
  await backupFile(filePath, paths);
  await fs.writeFile(filePath, stringifyToml(validated), "utf8");
  return validated;
}

export async function saveState(state, paths = getAppPaths()) {
  await ensureDir(paths.stateDir);
  await fs.writeFile(paths.stateFile, JSON.stringify(state, null, 2), "utf8");
}

export async function loadState(paths = getAppPaths()) {
  if (!(await fileExists(paths.stateFile))) return {};
  try {
    const content = await fs.readFile(paths.stateFile, "utf8");
    return JSON.parse(content);
  } catch {
    return {};
  }
}

export async function resolvePromptStack(resolvedConfig, cwd = process.cwd()) {
  const { paths } = resolvedConfig;
  const profile = resolvedConfig.activeProfile;
  const providerId = resolvedConfig.activeProvider;
  const bashEnabled =
    resolvedConfig.tools?.bash?.enabled ?? builtInConfig.tools.bash.enabled;
  const repoMapEnabled =
    resolvedConfig.intelligence?.repo_map?.enabled ??
    builtInConfig.intelligence.repo_map.enabled;
  const agentsEngineFile = await findProjectFileUpwards(cwd, "MRMUSH.md");
  const agentsFile = await findProjectFileUpwards(cwd, "AGENTS.md");
  const repoMapResult = repoMapEnabled
    ? await getRepoMapResult(cwd, {
        mode: resolvedConfig.intelligence?.repo_map?.mode,
        tokenBudget: resolvedConfig.intelligence?.repo_map?.token_budget,
        maxSymbolsPerFile:
          resolvedConfig.intelligence?.repo_map?.max_symbols_per_file,
        includeInternalSymbols:
          resolvedConfig.intelligence?.repo_map?.include_internal_symbols,
        deniedPaths: resolvedConfig.intelligence?.repo_map?.denied_paths,
      })
    : { text: "", stats: null };
  const layers = [
    {
      id: "project-mrmush",
      source: agentsEngineFile,
      content: agentsEngineFile ? await maybeReadText(agentsEngineFile) : null,
    },
    { id: "built-in", source: "built-in", content: DEFAULT_SYSTEM_PROMPT },
    {
      id: "global-system",
      source: paths.systemPromptFile,
      content: await maybeReadText(paths.systemPromptFile),
    },
    {
      id: "profile",
      source: paths.profilePromptFile(profile),
      content: await maybeReadText(paths.profilePromptFile(profile)),
    },
    {
      id: "provider",
      source: paths.providerPromptFile(providerId),
      content: await maybeReadText(paths.providerPromptFile(providerId)),
    },
    {
      id: "project-agents",
      source: agentsFile,
      content: agentsFile ? await maybeReadText(agentsFile) : null,
    },
    {
      id: "repo-map",
      source: "repo-map",
      content: repoMapResult.text,
      meta: repoMapResult.stats,
    },
    {
      id: "tools-file-ops",
      source: fileURLToPath(TOOLS_FILE_OPS_PROMPT_URL),
      content: bashEnabled
        ? await readBundledText(TOOLS_FILE_OPS_PROMPT_URL)
        : null,
    },
    {
      id: "project-system",
      source: paths.projectPromptFile,
      content: await maybeReadText(paths.projectPromptFile),
    },
  ].filter((layer) => layer.content && layer.content.trim().length > 0);

  return {
    layers,
    text: layers.map((layer) => layer.content.trim()).join("\n\n"),
  };
}

export async function loadConfig({
  cwd = process.cwd(),
  env = process.env,
  runtimeOverrides = {},
  homeDir = os.homedir(),
} = {}) {
  const paths = getAppPaths(cwd, homeDir);
  await ensureDir(paths.rootDir);
  await ensureDir(paths.promptsDir);
  await ensureDir(paths.profilesDir);
  await ensureDir(paths.providerPromptsDir);
  await ensurePromptFile(
    paths.systemPromptFile,
    DEFAULT_SYSTEM_PROMPT,
    LEGACY_DEFAULT_SYSTEM_PROMPT,
  );
  const globalConfig = (await readTomlFile(paths.configFile)) ?? {};
  const projectConfig = (await readTomlFile(paths.projectConfigFile)) ?? {};

  const merged = mergeObjects(
    mergeObjects(mergeObjects(builtInConfig, globalConfig), projectConfig),
    runtimeOverrides.config ?? {},
  );
  const withMigratedUi = migrateLegacyStatusbar(merged);
  const withEnv = applyEnvOverrides(withMigratedUi, env);
  const validated = userConfigSchema.parse(withEnv);
  const activeProvider =
    runtimeOverrides.providerId ?? validated.active_provider;
  const activeProfile = runtimeOverrides.profile ?? validated.active_profile;
  const activeProviderSettings = validated.providers[activeProvider] ?? {};
  const activeModel =
    runtimeOverrides.model ??
    activeProviderSettings.model ??
    validated.active_model ??
    builtInConfig.active_model;
  const thinkingLevel =
    runtimeOverrides.thinkingLevel ??
    activeProviderSettings.reasoning_effort ??
    validated.reasoning.default_effort ??
    builtInConfig.reasoning.default_effort;
  const promptStack = await resolvePromptStack(
    {
      paths,
      activeProfile,
      activeProvider,
      intelligence: validated.intelligence,
      tools: validated.tools,
    },
    cwd,
  );
  const state = await loadState(paths);

  return {
    ...validated,
    paths,
    state,
    activeProvider,
    activeModel,
    activeProfile,
    thinkingLevel,
    promptStack,
  };
}

export function parseConfigValue(rawValue) {
  const trimmed = rawValue.trim();
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed === "null") return null;
  if (/^-?\d+$/.test(trimmed)) return Number.parseInt(trimmed, 10);
  if (/^-?\d+\.\d+$/.test(trimmed)) return Number.parseFloat(trimmed);
  try {
    return JSON.parse(trimmed);
  } catch {
    return trimmed;
  }
}
