/**
 * Shell metacharacters that are always forbidden.
 * Pipe (|) is handled separately — allowed between allowlisted commands.
 * Glob chars (* ?) are allowed since they're commonly used in find/grep patterns
 * and are harmless in direct spawn mode (no shell expansion).
 */
const FORBIDDEN_SHELL_CHARS = /[;&<>`$(){}[\]\n\r]/;

/**
 * Characters that are dangerous inside double-quoted strings because
 * the shell (or spawn with shell:true) expands them.
 */
const DANGEROUS_IN_QUOTES = /[`$\\]/;

export function parseCommand(cmd) {
  const argv = [];
  let current = "";
  let quote = null;

  for (let index = 0; index < cmd.length; index += 1) {
    const char = cmd[index];
    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        // Reject dangerous characters inside double quotes.
        if (quote === "\"" && DANGEROUS_IN_QUOTES.test(char)) {
          return {
            ok: false,
            error: `Character "${char}" is not allowed inside double quotes`,
          };
        }
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

/**
 * Check whether the parsed command is permitted by the allowlist.
 *
 * @param {string[]} argv
 * @param {object}   config
 * @param {string[]} config.allowed_commands
 * @param {string[]} config.allowed_git_subcommands
 * @returns {{ ok: boolean, error?: string }}
 */
function checkAllowlist(argv, config) {
  const allowed = config.allowed_commands ?? [];
  const allowedGit = config.allowed_git_subcommands ?? [];

  // Empty allowlist means nothing is permitted.
  if (allowed.length === 0) {
    return { ok: false, error: "No commands are allowed (empty allowlist)" };
  }

  const base = argv[0];

  if (base === "git") {
    const sub = argv[1] ?? "";
    if (!allowedGit.includes(sub)) {
      return {
        ok: false,
        error: `git subcommand "${sub}" is not in the allowlist`,
      };
    }
    return { ok: true };
  }

  if (!allowed.includes(base)) {
    return {
      ok: false,
      error: `Command "${base}" is not in the allowlist`,
    };
  }

  return { ok: true };
}

/**
 * Evaluate whether a bash command string is safe to execute.
 *
 * Supports pipes (|) between allowed commands: each segment of the pipeline
 * is parsed and checked against the allowlist independently.
 *
 * @param {string} cmd           Raw command string from the model.
 * @param {object} [config={}]   Bash tool configuration from the user config.
 * @param {string[]} [config.allowed_commands]
 * @param {string[]} [config.allowed_git_subcommands]
 * @returns {{ ok: boolean, argv?: string[], shell: boolean, error?: string }}
 */
export function evaluateBashPolicy(cmd, config = {}) {
  if (typeof cmd !== "string" || cmd.trim().length === 0) {
    return { ok: false, error: "Empty command" };
  }
  if (cmd.includes("\0")) {
    return { ok: false, error: "NUL bytes are not allowed in bash commands" };
  }

  // Reject dangerous metacharacters (everything except pipe).
  if (FORBIDDEN_SHELL_CHARS.test(cmd)) {
    return {
      ok: false,
      error: "Shell metacharacters (;, &, <, >, `, $, etc.) are not allowed",
    };
  }

  // Split by pipe and validate each segment.
  const segments = cmd.split("|").map((s) => s.trim()).filter(Boolean);
  if (segments.length === 0) {
    return { ok: false, error: "Empty command" };
  }

  for (const segment of segments) {
    const parsed = parseCommand(segment);
    if (!parsed.ok) return parsed;

    const allowlistResult = checkAllowlist(parsed.argv, config);
    if (!allowlistResult.ok) return allowlistResult;
  }

  // Single command without pipes: use direct spawn (no shell).
  if (segments.length === 1) {
    const parsed = parseCommand(segments[0]);
    return {
      ok: true,
      argv: parsed.argv,
      shell: false,
    };
  }

  // Pipeline: must use shell to handle pipes.
  return {
    ok: true,
    argv: ["sh", "-c", cmd],
    shell: false, // we invoke sh explicitly, no need for spawn shell:true
  };
}
