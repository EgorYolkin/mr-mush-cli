import { runSetupScreen } from "./ui/scenes/setup.js";
import { runChatScreen } from "./ui/scenes/chat.js";
import { bootstrapConfig, hasGlobalConfig, loadConfig } from "./config/loader.js";

export class Router {
  constructor(context, ui) {
    this.context = context;
    this.ui = ui;
    this.currentScene = context.currentScene ?? "boot";
  }

  async navigate(sceneName) {
    this.currentScene = sceneName;
    await this.render();
  }

  async start() {
    while (this.currentScene !== "exit") {
      await this.render();
    }
  }

  async render() {
    this.context.ui = this.ui;

    switch (this.currentScene) {
      case "boot": {
        if (await hasGlobalConfig({ cwd: this.context.cwd })) {
          this.context.config = await loadConfig({
            cwd: this.context.cwd,
            runtimeOverrides: this.context.runtimeOverrides,
          }).catch(() => null);
          this.currentScene = this.context.config ? "chat" : "setup";
        } else {
          this.currentScene = "setup";
        }
        break;
      }
      case "setup": {
        const config = await runSetupScreen(this.context);
        this.context.config = config;
        this.currentScene = "chat";
        break;
      }
      case "chat":
        await bootstrapConfig({ cwd: this.context.cwd });
        this.context.config = await loadConfig({
          cwd: this.context.cwd,
          runtimeOverrides: this.context.runtimeOverrides,
        });
        await runChatScreen(this.context);
        break;
    }
  }
}
