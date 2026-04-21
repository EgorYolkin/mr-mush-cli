import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import MessageFormat from "@messageformat/core";

const DEFAULT_LOCALE = "ru";
const FALLBACK_LOCALE = "en";
const I18N_ENV_VAR = "AGENTS_ENGINE_LOCALE";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BUILTIN_LOCALES_DIR = path.resolve(__dirname, "../../locales");

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function deepMerge(base, extra) {
  if (!isPlainObject(base) || !isPlainObject(extra)) {
    return extra;
  }

  const merged = { ...base };
  for (const [key, value] of Object.entries(extra)) {
    if (isPlainObject(value) && isPlainObject(merged[key])) {
      merged[key] = deepMerge(merged[key], value);
      continue;
    }
    merged[key] = value;
  }
  return merged;
}

function getByPath(source, key) {
  return key.split(".").reduce((value, part) => {
    if (value == null) return undefined;
    return value[part];
  }, source);
}

function walkStrings(source, visit, prefix = "") {
  if (typeof source === "string") {
    visit(prefix, source);
    return;
  }

  if (Array.isArray(source)) {
    for (const [index, value] of source.entries()) {
      walkStrings(value, visit, `${prefix}.${index}`);
    }
    return;
  }

  if (!isPlainObject(source)) {
    return;
  }

  for (const [key, value] of Object.entries(source)) {
    const nextPrefix = prefix ? `${prefix}.${key}` : key;
    walkStrings(value, visit, nextPrefix);
  }
}

function getLocalePaths(locale, cwd) {
  const xdgConfigHome =
    process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config");

  return {
    builtin: path.join(BUILTIN_LOCALES_DIR, `${locale}.json`),
    global: path.join(
      xdgConfigHome,
      "agents-engine-cli",
      "locales",
      `${locale}.json`,
    ),
    project: path.join(cwd, ".agents-engine", "locales", `${locale}.json`),
  };
}

function readJsonFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function loadBuiltinLocale(locale) {
  const filePath = getLocalePaths(locale, process.cwd()).builtin;
  const data = readJsonFile(filePath);

  if (!data) {
    return null;
  }

  return { data, path: filePath };
}

function createFormatter(locale) {
  const cache = new Map();

  return (template, vars = {}) => {
    let formatter = cache.get(template);
    if (!formatter) {
      formatter = new MessageFormat(locale).compile(template);
      cache.set(template, formatter);
    }
    return formatter(vars);
  };
}

function validateMessages(catalog, locale) {
  const format = createFormatter(locale);
  walkStrings(catalog, (_, template) => {
    format(template);
  });
}

function formatWarning(baseCatalog, key, vars = {}) {
  const template = getByPath(baseCatalog, key);
  if (typeof template !== "string") {
    return vars.message ?? "";
  }

  return createFormatter(DEFAULT_LOCALE)(template, vars);
}

function loadOptionalLayer(locale, cwd, scope, baseCatalog) {
  const filePath = getLocalePaths(locale, cwd)[scope];

  try {
    const data = readJsonFile(filePath);
    if (!data) return {};
    validateMessages(data, locale);
    return data;
  } catch (error) {
    console.warn(
      formatWarning(baseCatalog, "warnings.overrideLoadFailed", {
        scope,
        path: filePath,
        message: error.message,
      }),
    );
    return {};
  }
}

function mergeCatalogs(catalogs) {
  return catalogs.reduce((acc, current) => deepMerge(acc, current), {});
}

export function resolveRuntimeLocale(cliArgs = process.argv.slice(2)) {
  let locale = null;
  const remainingArgs = [];

  for (let index = 0; index < cliArgs.length; index += 1) {
    const current = cliArgs[index];

    if (current === "--locale") {
      locale = cliArgs[index + 1] ?? null;
      index += 1;
      continue;
    }

    if (current.startsWith("--locale=")) {
      locale = current.slice("--locale=".length) || null;
      continue;
    }

    remainingArgs.push(current);
  }

  return {
    locale: locale ?? process.env[I18N_ENV_VAR] ?? DEFAULT_LOCALE,
    remainingArgs,
  };
}

export function createI18n({ locale, cwd = process.cwd() }) {
  const fallbackBuiltin = loadBuiltinLocale(FALLBACK_LOCALE);
  if (!fallbackBuiltin) {
    throw new Error(`Missing built-in locale file: ${FALLBACK_LOCALE}.json`);
  }
  validateMessages(fallbackBuiltin.data, FALLBACK_LOCALE);

  const defaultBuiltin = loadBuiltinLocale(DEFAULT_LOCALE) ?? fallbackBuiltin;
  validateMessages(defaultBuiltin.data, DEFAULT_LOCALE);

  const activeBuiltin =
    loadBuiltinLocale(locale) ?? defaultBuiltin ?? fallbackBuiltin;
  validateMessages(
    activeBuiltin.data,
    activeBuiltin === fallbackBuiltin ? FALLBACK_LOCALE : locale,
  );

  const mergedCatalog = mergeCatalogs([
    fallbackBuiltin.data,
    loadOptionalLayer(FALLBACK_LOCALE, cwd, "global", defaultBuiltin.data),
    loadOptionalLayer(FALLBACK_LOCALE, cwd, "project", defaultBuiltin.data),
    activeBuiltin.data,
    loadOptionalLayer(locale, cwd, "global", defaultBuiltin.data),
    loadOptionalLayer(locale, cwd, "project", defaultBuiltin.data),
  ]);

  const format = createFormatter(locale);

  return {
    locale,
    fallbackLocale: FALLBACK_LOCALE,
    raw(key) {
      return getByPath(mergedCatalog, key);
    },
    t(key, vars = {}) {
      const template = getByPath(mergedCatalog, key);
      if (typeof template !== "string") {
        throw new Error(`Missing i18n key: ${key}`);
      }
      return format(template, vars);
    },
  };
}
