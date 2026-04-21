const FORBIDDEN_SHELL_CHARS = /[;&|<>`$(){}[\]\n\r]/;
const READ_ONLY_COMMANDS = new Set(["pwd", "ls", "find", "rg", "cat", "sed", "head", "tail", "tree"]);
const READ_ONLY_GIT_SUBCOMMANDS = new Set(["status", "diff", "log", "show"]);

export function parseCommand(cmd) {
  if (FORBIDDEN_SHELL_CHARS.test(cmd)) {
    return {
      ok: false,
      error: "Shell metacharacters are not allowed in bash tool commands",
    };
  }

  const argv = [];
  let current = "";
  let quote = null;

  for (let index = 0; index < cmd.length; index += 1) {
    const char = cmd[index];
    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }

    if (char === "'" || char === "\"") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        argv.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }

  if (quote) {
    return { ok: false, error: "Unclosed quote in command" };
  }
  if (current) argv.push(current);
  if (argv.length === 0) {
    return { ok: false, error: "Empty command" };
  }

  return { ok: true, argv };
}

export function evaluateBashPolicy(cmd) {
  const parsed = parseCommand(cmd);
  if (!parsed.ok) return parsed;

  const [bin, subcommand] = parsed.argv;
  if (bin === "find" && parsed.argv.some((arg) => arg === "-exec" || arg === "-delete")) {
    return { ok: false, error: "find -exec and find -delete are not allowed" };
  }
  if (bin === "sed" && parsed.argv.some((arg) => arg === "-i" || arg.startsWith("-i"))) {
    return { ok: false, error: "sed in-place editing is not allowed" };
  }

  if (READ_ONLY_COMMANDS.has(bin)) {
    return { ok: true, argv: parsed.argv };
  }
  if (bin === "git" && READ_ONLY_GIT_SUBCOMMANDS.has(subcommand)) {
    return { ok: true, argv: parsed.argv };
  }

  return {
    ok: false,
    error: `Command is outside the read-only allowlist: ${bin}${subcommand ? ` ${subcommand}` : ""}`,
  };
}
