import * as p from "@clack/prompts";

const userRole = "user";
const chatSplitter = "—";

// components fabric
export const createComponents = (theme) => ({
  header: (title) => {
    console.clear();
    p.intro(theme.colors.primary.bgBlack(` ${title} `));
  },

  chatMessage: (role, text) => {
    const symbol = role === userRole ? theme.symbols.user : theme.symbols.ai;
    const color =
      role === userRole ? theme.colors.primary : theme.colors.success;
    console.log(`${symbol} ${color.bold(role.toUpperCase())}: ${text}\n`);
  },

  divider: () =>
    console.log(
      theme.colors.dim(chatSplitter.repeat(process.stdout.columns || 20)),
    ),
});
