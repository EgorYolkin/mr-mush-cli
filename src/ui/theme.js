import figures from "figures";
import chalk from "chalk";

export const defaultTheme = {
  colors: {
    primary: chalk.cyan,
    ai: chalk.magenta,
    user: chalk.blue,
    success: chalk.green,
    warning: chalk.yellow,
  },
  symbols: {
    robot: "\uf0e8",
    user: "👤",
    pointer: figures.pointer,
    info: figures.info,
    tick: figures.tick,
    bullet: figures.bullet,
  },
};
