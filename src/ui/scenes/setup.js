import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as p from "@clack/prompts";
import {
  PROVIDERS,
  getProvider,
  getProviderLabel,
} from "../../providers/index.js";
import {
  bootstrapConfig,
  loadConfig,
  saveConfig,
  saveState,
} from "../../config/loader.js";

const execFileAsync = promisify(execFile);

const onCancel = (i18n) => {
  p.cancel(i18n.t("setup.cancelled"));
  process.exit(0);
};

async function isBinaryInstalled(bin) {
  try {
    await execFileAsync("which", [bin]);
    return true;
  } catch {
    return false;
  }
}

async function buildProviderOptions(i18n) {
  const results = await Promise.all(
    PROVIDERS.map(async (prov) => {
      // API-провайдеры (ollama, lmstudio) проверяются через isAvailable(),
      // CLI-провайдеры — через наличие бинарника
      const available =
        prov.source === "api"
          ? await (prov.isAvailable?.() ?? Promise.resolve(false))
          : await isBinaryInstalled(prov.binary);
      return {
        value: prov.id,
        label: available
          ? getProviderLabel(prov, i18n)
          : `${getProviderLabel(prov, i18n)} (${i18n.t("providers.notInstalledSuffix")})`,
        disabled: !available,
      };
    }),
  );
  return results;
}

export async function runSetupScreen(context) {
  const { i18n, cwd, runtimeOverrides } = context;

  // Шаг 1: определяем какие CLI установлены
  const spinner = p.spinner();
  spinner.start(i18n.t("setup.spinner.checkingCli"));
  const providerOptions = await buildProviderOptions(i18n);

  const available = providerOptions.filter((o) => !o.disabled);
  if (available.length === 0) {
    p.log.error(
      i18n.t("setup.errors.noSupportedCli", {
        binaries: PROVIDERS.map((provider) => provider.binary).join(", "),
      }),
    );
    process.exit(1);
  }

  // Шаг 2: выбор провайдера
  const providerId = await p.select({
    message: i18n.t("setup.prompts.provider"),
    options: available,
  });
  if (p.isCancel(providerId)) onCancel(i18n);

  // Шаг 3: загрузка моделей через CLI провайдера
  spinner.start(i18n.t("setup.spinner.loadingModels", { providerId }));
  let modelOptions;

  try {
    const provider = getProvider(providerId, i18n);
    modelOptions = await provider.fetchModels();
    spinner.stop(
      i18n.t("setup.spinner.modelsFound", { count: modelOptions.length }),
    );
  } catch (err) {
    spinner.stop(i18n.t("setup.spinner.loadingModelsFailed"));
    p.log.error(err.message);
    process.exit(1);
  }

  // Шаг 4: выбор модели
  const model = await p.select({
    message: i18n.t("setup.prompts.model"),
    options: modelOptions,
  });
  if (p.isCancel(model)) onCancel(i18n);

  const detectedProviders = available.map((item) => {
    const provider = getProvider(item.value, i18n);
    return { id: provider.id, defaultModel: provider.defaultModel };
  });
  const paths = await bootstrapConfig({ cwd, detectedProviders });
  const baseConfig = await loadConfig({ cwd, runtimeOverrides });
  const nextConfig = {
    ...baseConfig,
    active_provider: providerId,
    active_model: model,
    providers: {
      ...baseConfig.providers,
      [providerId]: {
        ...baseConfig.providers[providerId],
        model,
      },
    },
  };

  await saveConfig(nextConfig, paths);
  await saveState(
    {
      ...baseConfig.state,
      schemaVersion: nextConfig.schema_version,
      lastUsedProvider: providerId,
      lastUsedModel: model,
      lastUsedProfile: nextConfig.active_profile,
      bootstrapCompletedAt: new Date().toISOString(),
    },
    paths,
  );

  return loadConfig({ cwd, runtimeOverrides });
}
