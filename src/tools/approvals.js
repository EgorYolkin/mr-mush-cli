import fs from "node:fs/promises";
import path from "node:path";

const APPROVALS_FILE = "approvals.json";

function approvalsPath(cwd) {
  return path.join(cwd, ".agents-engine", APPROVALS_FILE);
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

export async function isCommandApproved(cwd, cmd) {
  const approvals = await readApprovals(cwd);
  return approvals.bash.allowed.some((entry) => entry.cmd === cmd);
}

export async function approveCommand(cwd, cmd) {
  const approvals = await readApprovals(cwd);
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
