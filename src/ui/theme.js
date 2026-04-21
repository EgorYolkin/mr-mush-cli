import figures from "figures";
import chalk from "chalk";

export const defaultTheme = {
  colors: {
    primary: chalk.cyan,
    ai: chalk.magenta,
    user: chalk.blue,
    success: chalk.green,
    warning: chalk.yellow,
    accent: chalk.hex("#a855f7"),
    dim: chalk.dim,
    muted: chalk.hex("#94a3b8"),
    border: chalk.dim,
    input: chalk.hex("#a855f7"),
    title: chalk.bgHex("#a855f7").hex("#0b0f19").bold,
  },
  symbols: {
    robot: "\uf0e8",
    messageDot: "⬢",
    pointer: figures.pointer,
    info: figures.info,
    tick: figures.tick,
    bullet: figures.bullet,
    divider: "─",
    prompt: "❯",
    frame: {
      topLeft: "╭",
      topRight: "╮",
      bottomLeft: "╰",
      bottomRight: "╯",
      horizontal: "─",
      vertical: "│",
    },
  },
  layout: {
    agentName: "mr. mush",
    inputPaddingX: 0,
    transcriptIndent: "  ",
    messageIndent: "  ",
    continuationIndent: "    ",
    maxSuggestions: 8,
    splashTitle: "AGENTS ENGINE",
    splash: [
      "      ▄▄███▄▄",
      "    ▄███▀█▀███▄",
      "    ▀█████████▀",
      "       █████",
      // "        █ █",
      // "      ▀▀▀▀▀▀▀",
    ],
  },
  animation: {
    frames: ["◐", "◓", "◑", "◒"],
  },
};
