#!/usr/bin/env node
import fs from "node:fs/promises";
import process from "node:process";

import { APP_VERSION } from "../src/app-meta.js";
import { runHeadlessTask } from "../src/bench/headless.js";

function parseArgs(argv) {
  const args = {
    cwd: process.cwd(),
    instruction: null,
    instructionFile: null,
    provider: null,
    model: null,
    thinkingLevel: null,
    jsonOutput: null,
    stdout: true,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === "--version") {
      args.version = true;
      continue;
    }
    if (token === "--no-stdout") {
      args.stdout = false;
      continue;
    }
    if (token === "--cwd") {
      args.cwd = argv[index + 1];
      index += 1;
      continue;
    }
    if (token === "--instruction") {
      args.instruction = argv[index + 1];
      index += 1;
      continue;
    }
    if (token === "--instruction-file") {
      args.instructionFile = argv[index + 1];
      index += 1;
      continue;
    }
    if (token === "--provider") {
      args.provider = argv[index + 1];
      index += 1;
      continue;
    }
    if (token === "--model") {
      args.model = argv[index + 1];
      index += 1;
      continue;
    }
    if (token === "--thinking") {
      args.thinkingLevel = argv[index + 1];
      index += 1;
      continue;
    }
    if (token === "--json-output") {
      args.jsonOutput = argv[index + 1];
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${token}`);
  }

  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.version) {
    process.stdout.write(`${APP_VERSION}\n`);
    return;
  }

  const instruction = args.instructionFile
    ? await fs.readFile(args.instructionFile, "utf8")
    : args.instruction;
  const result = await runHeadlessTask({
    cwd: args.cwd,
    instruction,
    provider: args.provider,
    model: args.model,
    thinkingLevel: args.thinkingLevel,
    autoApproveTools: true,
  });

  if (args.jsonOutput) {
    await fs.writeFile(args.jsonOutput, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  }

  if (args.stdout) {
    process.stdout.write(result.text);
    if (result.text && !result.text.endsWith("\n")) {
      process.stdout.write("\n");
    }
  }
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
});
