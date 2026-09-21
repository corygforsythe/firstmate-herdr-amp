import { test } from "node:test";
import assert from "node:assert/strict";
import { parseKeys, splitTrailingPartialEscape } from "../src/lib/input.mjs";

test("parseKeys maps arrow escape sequences", () => {
  assert.deepEqual(parseKeys("\x1b[A\x1b[B\x1b[C\x1b[D"), ["up", "down", "right", "left"]);
});

test("parseKeys maps single-character shortcuts", () => {
  assert.deepEqual(parseKeys(" "), ["toggle"]);
  assert.deepEqual(parseKeys("\r"), ["enter"]);
  assert.deepEqual(parseKeys("s"), ["stop"]);
  assert.deepEqual(parseKeys("n"), ["next"]);
  assert.deepEqual(parseKeys("p"), ["prev"]);
  assert.deepEqual(parseKeys("+"), ["volup"]);
  assert.deepEqual(parseKeys("-"), ["voldown"]);
  assert.deepEqual(parseKeys("q"), ["quit"]);
  assert.deepEqual(parseKeys("\x03"), ["quit"]);
});

test("parseKeys is case-insensitive for letter shortcuts", () => {
  assert.deepEqual(parseKeys("SNP"), ["stop", "next", "prev"]);
});

test("parseKeys reports unrecognized characters as 'other'", () => {
  assert.deepEqual(parseKeys("z"), ["other"]);
});

test("parseKeys handles a mixed sequence of arrows and characters in one chunk", () => {
  assert.deepEqual(parseKeys("\x1b[Aq \x1b[C"), ["up", "quit", "toggle", "right"]);
});

test("splitTrailingPartialEscape passes through text with no trailing escape", () => {
  assert.deepEqual(splitTrailingPartialEscape("abc"), { complete: "abc", partial: "" });
});

test("splitTrailingPartialEscape holds back a lone ESC byte", () => {
  assert.deepEqual(splitTrailingPartialEscape("abc\x1b"), { complete: "abc", partial: "\x1b" });
});

test("splitTrailingPartialEscape holds back an incomplete CSI prefix", () => {
  assert.deepEqual(splitTrailingPartialEscape("abc\x1b["), { complete: "abc", partial: "\x1b[" });
});

test("splitTrailingPartialEscape treats a complete arrow sequence as complete", () => {
  assert.deepEqual(splitTrailingPartialEscape("abc\x1b[A"), { complete: "abc\x1b[A", partial: "" });
});
