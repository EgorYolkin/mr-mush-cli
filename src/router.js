import { runSetupScreen } from "./ui/scenes/setup.js";
import { runChatScreen } from "./ui/scenes/chat.js";

export class Router {
  constructor(context, ui) {
    this.context = context;
    this.ui = ui;
    this.currentScene = context.currentScene ?? "setup";
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
    switch (this.currentScene) {
      case "setup": {
        const config = await runSetupScreen();
        this.context.config = config;
        this.currentScene = "chat";
        break;
      }
      case "chat":
        await runChatScreen(this.context);
        break;
    }
  }
}
