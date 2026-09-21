// Pure parsing of raw terminal keypress bytes into named actions. No
// stdin/tty access here so this stays unit-testable with plain strings.

const ARROWS = {
  up: "\x1b[A",
  down: "\x1b[B",
  right: "\x1b[C",
  left: "\x1b[D",
};

const CHAR_KEYS = {
  " ": "toggle",
  "\r": "enter",
  "\n": "enter",
  s: "stop",
  S: "stop",
  n: "next",
  N: "next",
  p: "prev",
  P: "prev",
  "+": "volup",
  "=": "volup",
  "-": "voldown",
  _: "voldown",
  q: "quit",
  "\x03": "quit", // Ctrl+C
};

export function parseKeys(text) {
  const events = [];
  let i = 0;
  while (i < text.length) {
    let matchedArrow = null;
    for (const [name, seq] of Object.entries(ARROWS)) {
      if (text.startsWith(seq, i)) {
        matchedArrow = { name, len: seq.length };
        break;
      }
    }
    if (matchedArrow) {
      events.push(matchedArrow.name);
      i += matchedArrow.len;
      continue;
    }
    const ch = text[i];
    events.push(CHAR_KEYS[ch] || "other");
    i += 1;
  }
  return events;
}

const COMPLETE_ARROW_RE = /^\x1b\[[ABCD]/;
const PLAUSIBLE_PARTIAL_RE = /^\x1b(\[)?$/;

// A raw read can end mid-escape-sequence (e.g. an arrow key split across two
// 'data' events). Given a buffer, returns { complete, partial }: the prefix
// safe to parse now, and a trailing partial sequence to prepend to the next
// chunk.
export function splitTrailingPartialEscape(buf) {
  const escIdx = buf.lastIndexOf("\x1b");
  if (escIdx === -1) return { complete: buf, partial: "" };
  const tail = buf.slice(escIdx);
  if (COMPLETE_ARROW_RE.test(tail)) return { complete: buf, partial: "" };
  if (PLAUSIBLE_PARTIAL_RE.test(tail)) {
    return { complete: buf.slice(0, escIdx), partial: tail };
  }
  return { complete: buf, partial: "" };
}
