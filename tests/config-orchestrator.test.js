import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { builtInConfig } from "../src/config/schema.js";
import { getAppPaths, loadConfig, saveConfig } from "../src/config/loader.js";

test("saveConfig persists orchestrator settings", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mr-mush-config-"));
  const cwd = path.join(tempRoot, "workspace");
  const homeDir = path.join(tempRoot, "home");

  await fs.mkdir(cwd, { recursive: true });
  await fs.mkdir(homeDir, { recursive: true });

  const paths = getAppPaths(cwd, homeDir);
  await saveConfig({
    ...builtInConfig,
    orchestrator: {
      ...builtInConfig.orchestrator,
      enabled: true,
      router_provider: "openai",
      router_model: "gpt-4o-mini",
    },
  }, paths);

  const loaded = await loadConfig({ cwd, homeDir });

  assert.equal(loaded.orchestrator.enabled, true);
  assert.equal(loaded.orchestrator.router_provider, "openai");
  assert.equal(loaded.orchestrator.router_model, "gpt-4o-mini");
});

test("saveConfig persists repo map intelligence settings", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mr-mush-config-"));
  const cwd = path.join(tempRoot, "workspace");
  const homeDir = path.join(tempRoot, "home");

  await fs.mkdir(cwd, { recursive: true });
  await fs.mkdir(homeDir, { recursive: true });

  const paths = getAppPaths(cwd, homeDir);
  await saveConfig({
    ...builtInConfig,
    intelligence: {
      repo_map: {
        ...builtInConfig.intelligence.repo_map,
        enabled: true,
        mode: "compact",
        token_budget: 1500,
        max_symbols_per_file: 3,
        include_internal_symbols: false,
      },
    },
  }, paths);

  const loaded = await loadConfig({ cwd, homeDir });

  assert.equal(loaded.intelligence.repo_map.enabled, true);
  assert.equal(loaded.intelligence.repo_map.mode, "compact");
  assert.equal(loaded.intelligence.repo_map.token_budget, 1500);
  assert.equal(loaded.intelligence.repo_map.max_symbols_per_file, 3);
  assert.equal(loaded.intelligence.repo_map.include_internal_symbols, false);
});
