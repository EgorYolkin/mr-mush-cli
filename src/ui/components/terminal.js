// ─── Terminal surface utilities ───────────────────────────────────────────────

// Switches back to the normal screen buffer and disables mouse tracking.
// Used before writing inline output so the terminal scrollback is preserved.
export const INLINE_TERMINAL_MODE =
  "\x1b[?1049l\x1b[?1047l\x1b[?47l\x1b[?1000l\x1b[?1006l\x1b[?1l";

// Restores the normal screen buffer and anchors the viewport at the visible
// top-left corner before the chat scene starts drawing inline content.
// Uses \x1b[2J (clear screen) + \x1b[3J (clear scrollback) to prevent ghost
// frames in terminals that preserve scrollback (Ghostty, iTerm2, Kitty).
export function prepareInlineTerminalSurface() {
  process.stdout.write(`${INLINE_TERMINAL_MODE}\x1b[?25h\x1b[2J\x1b[3J\x1b[H`);
}

// Hard-reset the terminal surface: show cursor, clear screen and scrollback,
// move to top-left. Shared between the setup wizard and the chat scene.
export function resetTerminalSurface() {
  process.stdout.write("\x1b[?25h\x1b[2J\x1b[3J\x1b[H");
}
