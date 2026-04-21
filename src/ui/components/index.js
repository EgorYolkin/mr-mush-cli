import * as p from "@clack/prompts";

const userRole = "user";
const chatSplitter = "—";

// components fabric
export const createComponents = (theme, i18n) => ({
  header: (title) => {
    console.clear();
    p.intro(theme.colors.primary.bgBlack(` ${title} `));
  },

  chatMessage: (role, text) => {
    const symbol = role === userRole ? theme.symbols.user : theme.symbols.ai;
    const color =
      role === userRole ? theme.colors.primary : theme.colors.success;
    const roleLabel = i18n?.raw(`ui.roles.${role}`) ?? role.toUpperCase();
    console.log(`${symbol} ${color.bold(roleLabel)}: ${text}\n`);
  },

  divider: () =>
    console.log(
      theme.colors.dim(chatSplitter.repeat(process.stdout.columns || 20)),
    ),
});
