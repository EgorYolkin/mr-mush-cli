import fs from "node:fs/promises";
import path from "node:path";

const APPROVALS_FILE = "approvals.json";

/** Default time-to-live for project-scoped approvals: 7 days. */
const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function approvalsPath(cwd) {
  return path.join(cwd, ".mrmush", APPROVALS_FILE);
}

function isEntryExpired(entry, ttlMs) {
  if (!entry.created_at) return true;
  const age = Date.now() - new Date(entry.created_at).getTime();
  return age > ttlMs;
}

async function readApprovals(cwd) {
  try {
    const content = await fs.readFile(approvalsPath(cwd), "utf8");
    const parsed = JSON.parse(content);
    return {
      version: 1,
      bash: {
        allowed: Array.isArray(parsed?.bash?.allowed) ? parsed.bash.allowed : [],
      },
    };
  } catch {
    return { version: 1, bash: { allowed: [] } };
  }
}

async function writeApprovals(cwd, approvals) {
  const filePath = approvalsPath(cwd);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(approvals, null, 2)}\n`, "utf8");
}

export async function isCommandApproved(cwd, cmd, { ttlMs = DEFAULT_TTL_MS } = {}) {
  const approvals = await readApprovals(cwd);
  return approvals.bash.allowed.some(
    (entry) => entry.cmd === cmd && !isEntryExpired(entry, ttlMs),
  );
}

export async function approveCommand(cwd, cmd) {
  const approvals = await readApprovals(cwd);

  // Remove expired entries on write to keep the file clean.
  approvals.bash.allowed = approvals.bash.allowed.filter(
    (entry) => !isEntryExpired(entry, DEFAULT_TTL_MS),
  );

  if (!approvals.bash.allowed.some((entry) => entry.cmd === cmd)) {
    approvals.bash.allowed = [
      ...approvals.bash.allowed,
      {
        cmd,
        created_at: new Date().toISOString(),
      },
    ];
  }
  await writeApprovals(cwd, approvals);
}

