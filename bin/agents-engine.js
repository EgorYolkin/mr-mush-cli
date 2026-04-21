#!/usr/bin/env node
import { Router } from "../src/router.js";
import { initUI } from "../src/ui/index.js";
import { defaultTheme } from "../src/ui/theme.js";

async function main() {
  const ui = initUI(defaultTheme);

  const app = new Router(
    {
      currentScene: "setup",
      config: {},
    },
    ui,
  );

  await app.start();
}

main().catch((err) => {
  console.error("Критическая ошибка:", err);
  process.exit(1);
});
