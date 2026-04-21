import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import { builtInConfig, flattenZodIssues, userConfigSchema } from "./schema.js";

const APP_DIR_NAME = ".agents-engine";
const CONFIG_FILE_NAME = "config.toml";
const DEFAULT_SYSTEM_PROMPT = [
  "You are Agents Engine CLI.",
  "Be direct, precise, and pragmatic.",
  "Prefer concrete implementation details over generic advice.",
  "",
  "When you need to inspect the local project, request a tool call with exactly one fenced block:",
  "```agents-tool",
  "{\"name\":\"bash\",\"args\":{\"cmd\":\"git status --short\"}}",
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
};

function mergeObjects(base, override) {
  if (override === undefined) return structuredClone(base);
  if (Array.isArray(base) || Array.isArray(override)) return structuredClone(override);
  if (!base || !override || typeof base !== "object" || typeof override !== "object") {
    return structuredClone(override);
  }

  const result = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const existing = result[key];
    result[key] = existing && value && typeof existing === "object" && typeof value === "object"
      && !Array.isArray(existing) && !Array.isArray(value)
      ? mergeObjects(existing, value)
      : structuredClone(value);
  }
  return result;
}

function setAtPath(target, dottedPath, value) {
  const segments = dottedPath.split(".").filter(Boolean);
  if (segments.length === 0) throw new Error("Пустой путь конфигурации");

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

  if (env.AGENTS_ENGINE_PROVIDER) result.active_provider = env.AGENTS_ENGINE_PROVIDER;
  if (env.AGENTS_ENGINE_MODEL) result.active_model = env.AGENTS_ENGINE_MODEL;
  if (env.AGENTS_ENGINE_PROFILE) result.active_profile = env.AGENTS_ENGINE_PROFILE;
  if (env.AGENTS_ENGINE_THINKING) {
    result.reasoning = { ...result.reasoning, default_effort: env.AGENTS_ENGINE_THINKING };
  }

  return result;
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

export async function hasGlobalConfig({ cwd = process.cwd(), homeDir = os.homedir() } = {}) {
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
      `Невалидный конфиг ${filePath}\n${flattenZodIssues(result.error).join("\n")}`,
    );
  }
  return result.data;
}

async function maybeReadText(filePath) {
  if (!(await fileExists(filePath))) return null;
  return fs.readFile(filePath, "utf8");
}

async function findProjectFileUpwards(startDir, fileName) {
  let currentDir = startDir;
  while (true) {
    const candidate = path.join(currentDir, fileName);
    if (await fileExists(candidate)) return candidate;
    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) return null;
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
    projectDir,
    projectConfigFile: path.join(projectDir, CONFIG_FILE_NAME),
    promptsDir,
    systemPromptFile: path.join(promptsDir, "system.md"),
    profilesDir: path.join(promptsDir, "profiles"),
    profilePromptFile: (profile) => path.join(promptsDir, "profiles", `${profile}.md`),
    providerPromptsDir: path.join(promptsDir, "providers"),
    providerPromptFile: (providerId) => path.join(promptsDir, "providers", `${providerId}.md`),
    stateDir: path.join(rootDir, "state"),
    stateFile: path.join(rootDir, "state", "state.json"),
    cacheDir: path.join(rootDir, "cache"),
    modelsCacheFile: path.join(rootDir, "cache", "models.json"),
    logsDir: path.join(rootDir, "logs"),
    logFile: path.join(rootDir, "logs", "cli.log"),
    backupsDir: path.join(rootDir, "backups"),
    projectPromptFile: path.join(projectDir, "prompts", "system.md"),
  };
}

export async function bootstrapConfig({ cwd = process.cwd(), homeDir = os.homedir(), detectedProviders = [] } = {}) {
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
  ]);

  const defaultProvider = detectedProviders[0]?.id ?? builtInConfig.active_provider;
  const defaultModel = detectedProviders[0]?.defaultModel ?? builtInConfig.active_model;

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
  if (!(await fileExists(paths.systemPromptFile))) {
    await fs.writeFile(paths.systemPromptFile, `${DEFAULT_SYSTEM_PROMPT}\n`, "utf8");
  }
  if (!(await fileExists(paths.profilePromptFile("default")))) {
    await fs.writeFile(paths.profilePromptFile("default"), `${DEFAULT_PROFILE_PROMPT}\n`, "utf8");
  }

  await Promise.all(Object.entries(DEFAULT_PROVIDER_PROMPTS).map(async ([providerId, text]) => {
    const filePath = paths.providerPromptFile(providerId);
    if (!(await fileExists(filePath))) {
      await fs.writeFile(filePath, `${text}\n`, "utf8");
    }
  }));

  if (!(await fileExists(paths.stateFile))) {
    await fs.writeFile(paths.stateFile, JSON.stringify({
      schemaVersion: 1,
      bootstrapCompletedAt: new Date().toISOString(),
      lastUsedProvider: defaultProvider,
      lastUsedModel: defaultModel,
      lastUsedProfile: config.active_profile,
    }, null, 2), "utf8");
  }

  return paths;
}

export async function backupFile(filePath, paths = getAppPaths()) {
  if (!(await fileExists(filePath))) return null;
  await ensureDir(paths.backupsDir);
  const stamp = new Date().toISOString().replaceAll(":", "-");
  const target = path.join(paths.backupsDir, `${path.basename(filePath)}.${stamp}.bak`);
  await fs.copyFile(filePath, target);
  return target;
}

function toUserConfig(config) {
  return {
    schema_version: config.schema_version,
    active_provider: config.active_provider ?? config.activeProvider,
    active_model: config.active_model ?? config.activeModel,
    active_profile: config.active_profile ?? config.activeProfile,
    ui: config.ui,
    reasoning: config.reasoning,
    auth: config.auth,
    cache: config.cache,
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

export async function saveConfigPatch(dottedPath, value, { scope = "global", cwd = process.cwd(), homeDir = os.homedir() } = {}) {
  const paths = getAppPaths(cwd, homeDir);
  const filePath = scope === "project" ? paths.projectConfigFile : paths.configFile;
  const current = (await readTomlFile(filePath)) ?? {};
  const patched = setAtPath(structuredClone(current), dottedPath, value);
  const validated = userConfigSchema.parse(mergeObjects(builtInConfig, patched));

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
  const agentsEngineFile = await findProjectFileUpwards(cwd, "AGENTS-ENGINE.md");
  const agentsFile = await findProjectFileUpwards(cwd, "AGENTS.md");
  const layers = [
    { id: "project-agents-engine", source: agentsEngineFile, content: agentsEngineFile ? await maybeReadText(agentsEngineFile) : null },
    { id: "built-in", source: "built-in", content: DEFAULT_SYSTEM_PROMPT },
    { id: "global-system", source: paths.systemPromptFile, content: await maybeReadText(paths.systemPromptFile) },
    { id: "profile", source: paths.profilePromptFile(profile), content: await maybeReadText(paths.profilePromptFile(profile)) },
    { id: "provider", source: paths.providerPromptFile(providerId), content: await maybeReadText(paths.providerPromptFile(providerId)) },
    { id: "project-agents", source: agentsFile, content: agentsFile ? await maybeReadText(agentsFile) : null },
    { id: "project-system", source: paths.projectPromptFile, content: await maybeReadText(paths.projectPromptFile) },
  ].filter((layer) => layer.content && layer.content.trim().length > 0);

  return {
    layers,
    text: layers.map((layer) => layer.content.trim()).join("\n\n"),
  };
}

export async function loadConfig({ cwd = process.cwd(), env = process.env, runtimeOverrides = {}, homeDir = os.homedir() } = {}) {
  const paths = getAppPaths(cwd, homeDir);
  const globalConfig = (await readTomlFile(paths.configFile)) ?? {};
  const projectConfig = (await readTomlFile(paths.projectConfigFile)) ?? {};

  const merged = mergeObjects(
    mergeObjects(
      mergeObjects(builtInConfig, globalConfig),
      projectConfig,
    ),
    runtimeOverrides.config ?? {},
  );
  const withEnv = applyEnvOverrides(merged, env);
  const validated = userConfigSchema.parse(withEnv);
  const activeProvider = runtimeOverrides.providerId ?? validated.active_provider;
  const activeProfile = runtimeOverrides.profile ?? validated.active_profile;
  const activeProviderSettings = validated.providers[activeProvider] ?? {};
  const activeModel = runtimeOverrides.model
    ?? activeProviderSettings.model
    ?? validated.active_model
    ?? builtInConfig.active_model;
  const thinkingLevel = runtimeOverrides.thinkingLevel
    ?? activeProviderSettings.reasoning_effort
    ?? validated.reasoning.default_effort
    ?? builtInConfig.reasoning.default_effort;
  const promptStack = await resolvePromptStack({
    paths,
    activeProfile,
    activeProvider,
  }, cwd);
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
