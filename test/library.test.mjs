import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { scanLibrary, prettyTrackName } from "../src/lib/library.mjs";

function makeLibraryDir(fileNames) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "herdr-amp-library-test-"));
  for (const name of fileNames) {
    fs.writeFileSync(path.join(dir, name), "");
  }
  return dir;
}

test("prettyTrackName strips the extension and normalizes separators", () => {
  assert.equal(prettyTrackName("My_Cool-Track.mp3"), "My Cool Track");
  assert.equal(prettyTrackName("plain.mid"), "plain");
});

test("scanLibrary only picks up .mp3/.mid/.midi files, sorted by name", () => {
  const dir = makeLibraryDir(["Zebra.mp3", "apple.mid", "notes.txt", "song.MIDI"]);
  const tracks = scanLibrary(dir, () => null);
  assert.deepEqual(
    tracks.map((t) => t.name),
    ["apple", "song", "Zebra"]
  );
  assert.deepEqual(
    tracks.map((t) => t.kind),
    ["midi", "midi", "mp3"]
  );
});

test("scanLibrary ignores subdirectories", () => {
  const dir = makeLibraryDir(["track.mp3"]);
  fs.mkdirSync(path.join(dir, "a-directory.mp3"));
  const tracks = scanLibrary(dir, () => null);
  assert.equal(tracks.length, 1);
  assert.equal(tracks[0].name, "track");
});

test("scanLibrary calls the injected duration provider with filePath and kind", () => {
  const dir = makeLibraryDir(["one.mp3"]);
  const calls = [];
  const tracks = scanLibrary(dir, (filePath, kind) => {
    calls.push({ filePath, kind });
    return 123.4;
  });
  assert.equal(tracks[0].durationSeconds, 123.4);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].kind, "mp3");
  assert.ok(calls[0].filePath.endsWith("one.mp3"));
});

test("scanLibrary returns an empty list for a missing directory", () => {
  assert.deepEqual(scanLibrary("/no/such/directory/at/all", () => null), []);
});
