import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as p from "@clack/prompts";
import { PROVIDERS, getProvider } from "../../providers/index.js";

const execFileAsync = promisify(execFile);

const onCancel = () => {
  p.cancel("Настройка прервана");
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

async function buildProviderOptions() {
  const results = await Promise.all(
    PROVIDERS.map(async (prov) => {
      const available = await isBinaryInstalled(prov.binary);
      return {
        value: prov.id,
        label: available ? prov.label : `${prov.label} (не установлен)`,
        disabled: !available,
      };
    }),
  );
  return results;
}

export async function runSetupScreen() {
  // Шаг 1: определяем какие CLI установлены
  const spinner = p.spinner();
  spinner.start("Проверяю установленные CLI...");
  const providerOptions = await buildProviderOptions();
  spinner.stop("Готово");

  const available = providerOptions.filter((o) => !o.disabled);
  if (available.length === 0) {
    p.log.error("Не найден ни один поддерживаемый CLI (codex, claude)");
    process.exit(1);
  }

  // Шаг 2: выбор провайдера
  const providerId = await p.select({
    message: "Выберите провайдера:",
    options: available,
  });
  if (p.isCancel(providerId)) onCancel();

  // Шаг 3: загрузка моделей через CLI провайдера
  spinner.start(`Загружаю модели через ${providerId} CLI...`);
  let modelOptions;

  try {
    const provider = getProvider(providerId);
    modelOptions = await provider.fetchModels();
    spinner.stop(`Найдено моделей: ${modelOptions.length}`);
  } catch (err) {
    spinner.stop("Не удалось загрузить модели");
    p.log.error(err.message);
    process.exit(1);
  }

  // Шаг 4: выбор модели
  const model = await p.select({
    message: "Выберите модель:",
    options: modelOptions,
  });
  if (p.isCancel(model)) onCancel();

  return { providerId, model };
}
