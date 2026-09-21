import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadConfig, DEFAULT_VOLUME_PERCENT } from "../src/lib/config.mjs";

function makeConfigDir(contents) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "herdr-amp-config-test-"));
  if (contents !== undefined) {
    fs.writeFileSync(path.join(dir, "config.json"), contents);
  }
  return dir;
}

test("returns defaults when configDir is not provided", () => {
  const config = loadConfig(undefined);
  assert.equal(config.musicDir, null);
  assert.equal(config.soundFontPath, null);
  assert.equal(config.defaultVolumePercent, DEFAULT_VOLUME_PERCENT);
});

test("returns defaults when config.json is missing", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "herdr-amp-config-test-"));
  const config = loadConfig(dir);
  assert.equal(config.musicDir, null);
});

test("returns defaults when config.json is malformed", () => {
  const dir = makeConfigDir("{ not valid json");
  const config = loadConfig(dir);
  assert.equal(config.defaultVolumePercent, DEFAULT_VOLUME_PERCENT);
});

test("applies well-formed overrides", () => {
  const dir = makeConfigDir(
    JSON.stringify({
      musicDir: "/tmp/my-music",
      soundFontPath: "/tmp/gm.sf2",
      defaultVolumePercent: 42,
    })
  );
  const config = loadConfig(dir);
  assert.equal(config.musicDir, "/tmp/my-music");
  assert.equal(config.soundFontPath, "/tmp/gm.sf2");
  assert.equal(config.defaultVolumePercent, 42);
});

test("ignores an out-of-range defaultVolumePercent", () => {
  const dir = makeConfigDir(JSON.stringify({ defaultVolumePercent: 150 }));
  const config = loadConfig(dir);
  assert.equal(config.defaultVolumePercent, DEFAULT_VOLUME_PERCENT);
});

test("ignores blank string overrides", () => {
  const dir = makeConfigDir(JSON.stringify({ musicDir: "   ", soundFontPath: "" }));
  const config = loadConfig(dir);
  assert.equal(config.musicDir, null);
  assert.equal(config.soundFontPath, null);
});
