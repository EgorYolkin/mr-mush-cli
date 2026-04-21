import { spawn } from "node:child_process";

function safeEnv() {
  return {
    PATH: process.env.PATH ?? "",
    HOME: process.env.HOME ?? "",
    TERM: process.env.TERM ?? "xterm-256color",
    LANG: process.env.LANG ?? "C.UTF-8",
  };
}

function truncate(value, maxChars) {
  if (value.length <= maxChars) return { value, truncated: false };
  return {
    value: value.slice(0, maxChars),
    truncated: true,
  };
}

export function runBashCommand({ argv, cmd, cwd, timeoutMs, maxOutputChars }) {
  return new Promise((resolve) => {
    const child = spawn(argv[0], argv.slice(1), {
      cwd,
      env: safeEnv(),
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let outputTruncated = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);

    function appendOutput(kind, chunk) {
      const next = kind === "stdout" ? stdout + chunk.toString() : stderr + chunk.toString();
      const truncated = truncate(next, maxOutputChars);
      outputTruncated = outputTruncated || truncated.truncated;
      if (kind === "stdout") stdout = truncated.value;
      else stderr = truncated.value;
    }

    child.stdout.on("data", (chunk) => appendOutput("stdout", chunk));
    child.stderr.on("data", (chunk) => appendOutput("stderr", chunk));

    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({
        tool: "bash",
        cmd,
        exit_code: null,
        stdout,
        stderr: err.message,
        truncated: outputTruncated,
        timed_out: false,
      });
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        tool: "bash",
        cmd,
        exit_code: timedOut ? null : code,
        stdout,
        stderr,
        truncated: outputTruncated,
        timed_out: timedOut,
      });
    });
  });
}
