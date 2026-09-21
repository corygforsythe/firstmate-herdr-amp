import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TUI_SCRIPT = path.join(__dirname, "..", "src", "amp-tui.mjs");

// A minimal Standard MIDI File: format 0, 1 track, 96 ticks/quarter, default
// tempo (no Set Tempo event), 192 ticks total -> exactly 1.0s (see
// test/midi.test.mjs for the same math spelled out in isolation).
function buildMinimalMidiBuffer() {
  const header = Buffer.from([
    0x4d, 0x54, 0x68, 0x64, // "MThd"
    0x00, 0x00, 0x00, 0x06,
    0x00, 0x00, // format 0
    0x00, 0x01, // 1 track
    0x00, 0x60, // division = 96
  ]);
  const trackBody = Buffer.from([
    0x81, 0x40, 0xff, 0x2f, 0x00, // delta 192 (VLQ), end of track
  ]);
  const trackHeader = Buffer.alloc(8);
  trackHeader.write("MTrk", 0, "ascii");
  trackHeader.writeUInt32BE(trackBody.length, 4);
  return Buffer.concat([header, trackHeader, trackBody]);
}

function setupFixtureDirs() {
  const musicDir = fs.mkdtempSync(path.join(os.tmpdir(), "herdr-amp-tracks-"));
  fs.writeFileSync(path.join(musicDir, "Song One.mp3"), Buffer.from("not-really-an-mp3"));
  fs.writeFileSync(path.join(musicDir, "Song Two.mid"), buildMinimalMidiBuffer());

  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), "herdr-amp-config-"));
  fs.writeFileSync(path.join(configDir, "config.json"), JSON.stringify({ musicDir }));
  return { musicDir, configDir };
}

test("non-interactive mode lists the playlist and surfaces a missing-backend error on play", async () => {
  const { configDir } = setupFixtureDirs();

  const child = spawn(process.execPath, [TUI_SCRIPT], {
    env: {
      ...process.env,
      HERDR_PLUGIN_CONFIG_DIR: configDir,
      // Deliberately excludes ffplay/fluidsynth so "enter" hits a
      // deterministic, side-effect-free ENOENT instead of possibly
      // launching real audio playback during a test run.
      PATH: "/usr/bin:/bin",
    },
    stdio: ["pipe", "pipe", "pipe"],
  });

  let output = "";
  child.stdout.on("data", (d) => {
    output += d;
  });
  let stderr = "";
  child.stderr.on("data", (d) => {
    stderr += d;
  });

  await new Promise((resolve) => setTimeout(resolve, 300));
  child.stdin.write("enter\n");
  await new Promise((resolve) => setTimeout(resolve, 300));
  child.stdin.write("quit\n");

  const exitCode = await new Promise((resolve) => child.on("close", resolve));

  assert.equal(exitCode, 0, `stderr: ${stderr}`);
  assert.match(output, /Song One \(--:--\)/);
  assert.match(output, /Song Two \(00:01\)/);
  assert.match(output, /ERROR: Failed to start player/);
});

test("non-interactive mode reports an empty playlist for a directory with no audio files", async () => {
  const musicDir = fs.mkdtempSync(path.join(os.tmpdir(), "herdr-amp-empty-"));
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), "herdr-amp-empty-config-"));
  fs.writeFileSync(path.join(configDir, "config.json"), JSON.stringify({ musicDir }));

  const child = spawn(process.execPath, [TUI_SCRIPT], {
    env: { ...process.env, HERDR_PLUGIN_CONFIG_DIR: configDir, PATH: "/usr/bin:/bin" },
    stdio: ["pipe", "pipe", "pipe"],
  });

  let output = "";
  child.stdout.on("data", (d) => {
    output += d;
  });

  await new Promise((resolve) => setTimeout(resolve, 200));
  child.stdin.write("quit\n");
  const exitCode = await new Promise((resolve) => child.on("close", resolve));

  assert.equal(exitCode, 0);
  assert.match(output, /No track loaded\./);
  assert.match(output, /Herdr Amp — 0 track\(s\)/);
});
