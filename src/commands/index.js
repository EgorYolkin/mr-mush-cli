import chalk from "chalk";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  backupFile,
  loadConfig,
  parseConfigValue,
  saveConfig,
  saveConfigPatch,
} from "../config/loader.js";

export const DOT_CHOICES = [
  "✦", "⌁", "⁛", "⧉", "⬩", "✲", "✧", "✺", "⋆", "❈", "❯", "⊞", "⚬", "⁝", "⊹", "▰", "▱", "◈", "❖", "◬", "⬢", "⧇", "✬", "✫", "☄", "☾", "☽", "❂", "✵", "➱", "⚙", "⚯", "⑇", "♾", "⚡", "✿", "✽", "❀", "❦", "✥", "╾", "╼", "⁖", "▓", "▒", "░", "⟦", "⟧", "❮", "ᗢ", "⚆", "ꕤ", "ೃ", "༄", "✾", "❁", "❃", "❄", "❅", "❆", "❉", "❊", "❋", "✱", "✳", "✴", "✶", "✷", "✸", "✹", "✻", "✼", "✩", "✪", "✭", "✮", "✯", "✰", "⁕", "⁗", "⁘", "⁙", "⁚", "⁜", "⁞", "⍟", "⊛", "⊜", "⊝", "⊟", "⊠", "⊡", "⋇", "⋈", "⋉", "⋊", "⋋", "⋌", "⋍", "⋎", "⋏", "⋐", "⋑", "⋒", "⋓", "⋔", "⋕", "⋖", "⋗", "⋘", "⋙", "⋚", "⋛", "⋜", "⋝", "⋞", "⋟"
];

export const COMMANDS = [
  {
    name: "think",
    descriptionKey: "commands.descriptions.think",
    args: [
      { value: "off", descriptionKey: "commands.args.off" },
      { value: "minimal", descriptionKey: "commands.args.minimal" },
      { value: "low", descriptionKey: "commands.args.low" },
      { value: "medium", descriptionKey: "commands.args.medium" },
      { value: "high", descriptionKey: "commands.args.high" },
      { value: "xhigh", descriptionKey: "commands.args.xhigh" }
    ]
  },
  { name: "config", descriptionKey: "commands.descriptions.config" },
  { name: "provider", descriptionKey: "commands.descriptions.provider" },
  { name: "model", descriptionKey: "commands.descriptions.model" },
  { name: "profile", descriptionKey: "commands.descriptions.profile" },
  { name: "prompt", descriptionKey: "commands.descriptions.prompt" },
  { name: "statusbar", descriptionKey: "commands.descriptions.statusbar" },
  {
    name: "dot",
    descriptionKey: "commands.descriptions.dot",
    args: DOT_CHOICES.map((dot) => ({
      value: dot,
      descriptionKey: "commands.args.dot"
    }))
  }
];

export function getSuggestions(buffer, i18n) {
  if (!buffer.startsWith("/")) return [];

  const withoutSlash = buffer.slice(1);
  const spaceIdx = withoutSlash.indexOf(" ");

  if (spaceIdx === -1) {
    return COMMANDS.filter((command) => command.name.startsWith(withoutSlash)).map(
      (command) => ({
        label: `/${command.name}`,
        description: i18n?.raw(command.descriptionKey) ?? command.descriptionKey,
        complete: `/${command.name} `
      }),
    );
  }

  const cmdName = withoutSlash.slice(0, spaceIdx);
  const argPrefix = withoutSlash.slice(spaceIdx + 1);
  const command = COMMANDS.find((entry) => entry.name === cmdName);
  if (!command?.args) return [];

  return command.args
    .filter((arg) => arg.value.startsWith(argPrefix))
    .map((arg) => ({
      label: arg.value,
      description: i18n?.raw(arg.descriptionKey) ?? arg.descriptionKey,
      complete: `/${cmdName} ${arg.value}`
    }));
}

const EFFORT_MAP = {
  off: null,
  minimal: "low",
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: "xhigh"
};

function printSuccess(message) {
  process.stdout.write(`\n  ${chalk.green("✓")} ${message}\n\n`);
}

function printError(message, i18n) {
  process.stdout.write(
    `\n  ${chalk.red(i18n.t("commands.messages.errorPrefix"))} ${message}\n\n`,
  );
}

function getPromptLayerPath(layer, config, i18n) {
  switch (layer) {
    case "system":
      return config.paths.systemPromptFile;
    case "profile":
      return config.paths.profilePromptFile(config.activeProfile);
    case "provider":
      return config.paths.providerPromptFile(config.activeProvider);
    case "project":
      return config.paths.projectPromptFile;
    default:
      throw new Error(i18n.t("commands.errors.unknownPromptLayer", { layer }));
  }
}

async function openEditor(filePath, editor, i18n) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const child = spawn(editor, [filePath], { stdio: "inherit" });

  await new Promise((resolve, reject) => {
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new Error(i18n.t("commands.errors.editorExited", { editor, code })),
      );
    });
    child.on("error", reject);
  });
}

function formatConfigView(config, runtimeOverrides) {
  return JSON.stringify(
    {
      active_provider: config.activeProvider,
      active_model: config.activeModel,
      active_profile: config.activeProfile,
      thinking: runtimeOverrides.thinkingLevel ?? config.thinkingLevel,
      prompt_layers: config.promptStack.layers.map((layer) => layer.source),
      config_file: config.paths.configFile
    },
    null,
    2,
  );
}

export async function executeCommand(text, context) {
  const { i18n } = context;
  const [rawCmd, ...argParts] = text.slice(1).trim().split(/\s+/);
  const arg = argParts[0] ?? "";
  const config = await loadConfig({
    cwd: context.cwd,
    runtimeOverrides: context.runtimeOverrides
  });

  switch (rawCmd) {
    case "think": {
      const level = Object.keys(EFFORT_MAP).includes(arg) ? arg : "medium";
      context.runtimeOverrides = {
        ...context.runtimeOverrides,
        thinkingLevel: level
      };

      const effort = EFFORT_MAP[level];
      const display = effort ? chalk.cyan(level) : chalk.dim("off");
      printSuccess(
        i18n.t("commands.messages.thinkingSet", {
          tick: chalk.green("✓"),
          level: display
        }).replace(`${chalk.green("✓")} `, ""),
      );
      return true;
    }
    case "dot": {
      const dot = DOT_CHOICES.includes(arg) ? arg : "⬢";
      context.runtimeOverrides = {
        ...context.runtimeOverrides,
        config: {
          ...(context.runtimeOverrides.config ?? {}),
          ui: {
            ...(context.runtimeOverrides.config?.ui ?? {}),
            message_dot: dot
          }
        }
      };

      await saveConfigPatch("ui.message_dot", dot, {
        cwd: context.cwd,
        homeDir: os.homedir()
      });

      printSuccess(i18n.t("commands.messages.dotSet", { dot }));
      return true;
    }
    case "statusbar": {
      const prompt = argParts.join(" ").trim();
      if (!prompt) {
        printError(i18n.t("commands.errors.usageStatusbar"), i18n);
        return true;
      }

      context.runtimeOverrides = {
        ...context.runtimeOverrides,
        config: {
          ...(context.runtimeOverrides.config ?? {}),
          ui: {
            ...(context.runtimeOverrides.config?.ui ?? {}),
            statusbar_prompt: prompt
          }
        }
      };

      await saveConfigPatch("ui.statusbar_prompt", prompt, {
        cwd: context.cwd,
        homeDir: os.homedir()
      });

      printSuccess(i18n.t("commands.messages.statusbarSet", { prompt }));
      return true;
    }
    case "config": {
      const sub = argParts[0] ?? "show";

      if (sub === "show") {
        process.stdout.write(`\n${formatConfigView(config, context.runtimeOverrides)}\n\n`);
        return true;
      }

      if (sub === "set") {
        const targetPath = argParts[1];
        const rawValue = argParts.slice(2).join(" ");
        if (!targetPath || !rawValue) {
          printError(i18n.t("commands.errors.usageConfigSet"), i18n);
          return true;
        }

        const next = await saveConfigPatch(
          targetPath,
          parseConfigValue(rawValue),
          {
            cwd: context.cwd,
            homeDir: os.homedir()
          },
        );

        context.config = {
          ...config,
          ...next
        };

        printSuccess(i18n.t("commands.messages.configUpdated", { path: targetPath }));
        return true;
      }

      if (sub === "save") {
        const activeProvider =
          context.runtimeOverrides.providerId ?? config.activeProvider;

        const next = {
          ...config,
          active_provider: activeProvider,
          active_model: context.runtimeOverrides.model ?? config.activeModel,
          active_profile: context.runtimeOverrides.profile ?? config.activeProfile,
          reasoning: {
            ...config.reasoning,
            default_effort:
              context.runtimeOverrides.thinkingLevel ?? config.thinkingLevel
          },
          providers: {
            ...config.providers,
            [activeProvider]: {
              ...config.providers[activeProvider],
              model: context.runtimeOverrides.model ?? config.activeModel
            }
          }
        };

        await saveConfig(next, config.paths);
        context.runtimeOverrides = {};
        printSuccess(
          i18n.t("commands.messages.configSaved", {
            path: config.paths.configFile
          }),
        );
        return true;
      }

      printError(
        i18n.t("commands.errors.unknownConfigSubcommand", {
          subcommand: sub
        }),
        i18n,
      );
      return true;
    }
    case "provider": {
      if (argParts[0] !== "use" || !argParts[1]) {
        printError(i18n.t("commands.errors.usageProviderUse"), i18n);
        return true;
      }

      context.runtimeOverrides = {
        ...context.runtimeOverrides,
        providerId: argParts[1]
      };
      printSuccess(
        i18n.t("commands.messages.providerSet", { providerId: argParts[1] }),
      );
      return true;
    }
    case "model": {
      if (argParts[0] !== "use" || !argParts[1]) {
        printError(i18n.t("commands.errors.usageModelUse"), i18n);
        return true;
      }

      context.runtimeOverrides = {
        ...context.runtimeOverrides,
        model: argParts[1]
      };
      printSuccess(i18n.t("commands.messages.modelSet", { model: argParts[1] }));
      return true;
    }
    case "profile": {
      if (argParts[0] !== "use" || !argParts[1]) {
        printError(i18n.t("commands.errors.usageProfileUse"), i18n);
        return true;
      }

      context.runtimeOverrides = {
        ...context.runtimeOverrides,
        profile: argParts[1],
        config: {
          active_profile: argParts[1]
        }
      };
      printSuccess(
        i18n.t("commands.messages.profileSet", { profile: argParts[1] }),
      );
      return true;
    }
    case "prompt": {
      const sub = argParts[0] ?? "show";
      const layer = argParts[1] ?? "system";
      const filePath = getPromptLayerPath(layer, config, i18n);

      if (sub === "show") {
        const content = await fs.readFile(filePath, "utf8").catch(() => "");
        process.stdout.write(
          `\n${i18n.t("commands.messages.promptHeader", { layer })}\n${content}\n`,
        );
        return true;
      }

      if (sub === "edit") {
        const editor = config.ui.editor || process.env.EDITOR || "vi";
        await backupFile(filePath, config.paths);
        await openEditor(filePath, editor, i18n);
        printSuccess(i18n.t("commands.messages.promptEdited", { layer }));
        return true;
      }

      if (sub === "reset") {
        const sourcePath = getPromptLayerPath(
          layer,
          await loadConfig({ cwd: context.cwd }),
          i18n,
        );
        const defaultText =
          layer === "system"
            ? "You are Agents Engine CLI.\nBe direct, precise, and pragmatic.\nPrefer concrete implementation details over generic advice.\n"
            : layer === "profile"
              ? "Default profile:\n- Keep answers concise.\n- Explain tradeoffs when they affect implementation.\n"
              : layer === "provider"
                ? `Provider guidance: prefer ${config.activeProvider} compatible instructions.\n`
                : "";

        await backupFile(filePath, config.paths);
        await fs.mkdir(path.dirname(sourcePath), { recursive: true });
        await fs.writeFile(filePath, defaultText, "utf8");
        printSuccess(i18n.t("commands.messages.promptReset", { layer }));
        return true;
      }

      printError(
        i18n.t("commands.errors.unknownPromptSubcommand", {
          subcommand: sub
        }),
        i18n,
      );
      return true;
    }
    default:
      process.stdout.write(
        `\n  ${chalk.red(i18n.t("commands.messages.unknownCommand", { command: rawCmd }))}\n\n`,
      );
      return true;
  }
}
