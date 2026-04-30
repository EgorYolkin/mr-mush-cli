import test from "node:test";
import assert from "node:assert/strict";

import {
  INLINE_TERMINAL_MODE,
  prepareInlineTerminalSurface,
} from "../../src/ui/components/terminal.js";

test("prepareInlineTerminalSurface restores normal buffer and anchors cursor", (t) => {
  const writes = [];
  const originalWrite = process.stdout.write.bind(process.stdout);

  t.mock.method(process.stdout, "write", (chunk) => {
    writes.push(String(chunk));
    return true;
  });

  prepareInlineTerminalSurface();

  assert.deepEqual(writes, [
    `${INLINE_TERMINAL_MODE}\x1b[?25h\x1b[2J\x1b[3J\x1b[H`,
  ]);

  process.stdout.write = originalWrite;
});
