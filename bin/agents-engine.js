#!/usr/bin/env node
import { Router } from "../src/router.js";
import { createI18n, resolveRuntimeLocale } from "../src/i18n/index.js";
import { initUI } from "../src/ui/index.js";
import { defaultTheme } from "../src/ui/theme.js";

async function main() {
  const { locale } = resolveRuntimeLocale();
  const i18n = createI18n({ locale, cwd: process.cwd() });
  const ui = initUI(defaultTheme, i18n);

  const app = new Router(
    {
      currentScene: "boot",
      cwd: process.cwd(),
      config: {},
      runtimeOverrides: {},
      locale,
      i18n,
    },
    ui,
  );

  await app.start();
}

main().catch((err) => {
  try {
    const { locale } = resolveRuntimeLocale();
    const i18n = createI18n({ locale, cwd: process.cwd() });
    console.error(i18n.t("app.fatalError", { message: err.message }));
  } catch {
    console.error(`Fatal error: ${err.message}`);
  }
  process.exit(1);
});
