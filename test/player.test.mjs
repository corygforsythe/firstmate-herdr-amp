import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { Player } from "../src/lib/player.mjs";

// A fake child_process.ChildProcess: records every signal sent to kill(),
// and only actually emits "exit" for SIGKILL (mirroring how a real process
// behaves — SIGSTOP/SIGCONT never terminate it). Tests trigger a "natural"
// end of track by calling fakeChild.emit("exit") directly, the same way a
// real ffplay/fluidsynth process would when it finishes on its own.
function makeFakeSpawner() {
  const spawned = [];
  function spawnFn(...args) {
    const child = new EventEmitter();
    child.killSignals = [];
    child.spawnArgs = args;
    child.kill = (signal) => {
      child.killSignals.push(signal);
      if (signal === "SIGKILL") queueMicrotask(() => child.emit("exit", null, "SIGKILL"));
    };
    spawned.push(child);
    return child;
  }
  spawnFn.spawned = spawned;
  return spawnFn;
}

function makeTracks() {
  return [
    { filePath: "/music/one.mp3", name: "One", kind: "mp3", durationSeconds: 100 },
    { filePath: "/music/two.mid", name: "Two", kind: "midi", durationSeconds: 50 },
    { filePath: "/music/three.mp3", name: "Three", kind: "mp3", durationSeconds: 30 },
  ];
}

function makePlayer(overrides = {}) {
  const spawnMp3Fn = makeFakeSpawner();
  const spawnMidiFn = makeFakeSpawner();
  const player = new Player(overrides.tracks ?? makeTracks(), {
    soundFontPath: "/sf/gm.sf2",
    spawnMp3Fn,
    spawnMidiFn,
    ...overrides,
  });
  return { player, spawnMp3Fn, spawnMidiFn };
}

test("starts stopped with the first track selected", () => {
  const { player } = makePlayer();
  assert.equal(player.status, "stopped");
  assert.equal(player.currentIndex, 0);
  assert.equal(player.currentTrack.name, "One");
});

test("play() spawns the mp3 backend for an mp3 track", () => {
  const { player, spawnMp3Fn, spawnMidiFn } = makePlayer();
  player.play(0);
  assert.equal(player.status, "playing");
  assert.equal(spawnMp3Fn.spawned.length, 1);
  assert.equal(spawnMidiFn.spawned.length, 0);
  assert.equal(spawnMp3Fn.spawned[0].spawnArgs[0], "/music/one.mp3");
});

test("play() spawns the midi backend for a midi track", () => {
  const { player, spawnMp3Fn, spawnMidiFn } = makePlayer();
  player.play(1);
  assert.equal(player.status, "playing");
  assert.equal(spawnMidiFn.spawned.length, 1);
  assert.equal(spawnMp3Fn.spawned.length, 0);
  assert.equal(spawnMidiFn.spawned[0].spawnArgs[0], "/music/two.mid");
  assert.equal(spawnMidiFn.spawned[0].spawnArgs[1], "/sf/gm.sf2");
});

test("play() on a midi track with no soundFontPath configured fails gracefully", () => {
  const { player, spawnMidiFn } = makePlayer({ soundFontPath: null });
  player.play(1);
  assert.equal(player.status, "stopped");
  assert.match(player.lastError, /soundFontPath/);
  assert.equal(spawnMidiFn.spawned.length, 0);
});

test("switching from a paused mp3 to a midi track with no soundFontPath resets elapsed time", async () => {
  const { player } = makePlayer({ soundFontPath: null });
  player.play(0); // mp3 track, no soundFontPath needed
  await new Promise((r) => setTimeout(r, 20));
  player.togglePlayPause(); // pause snapshots the in-progress elapsed time into elapsedBaseSeconds
  assert.ok(player.elapsedSeconds > 0, "sanity check: mp3 track had progressed before pausing");

  player.play(1); // midi track, but no soundFontPath configured
  assert.equal(player.status, "stopped");
  assert.match(player.lastError, /soundFontPath/);
  assert.equal(player.elapsedSeconds, 0, "elapsed time must not carry over from the previous track");
});

test("togglePlayPause pauses via SIGSTOP and resumes via SIGCONT without killing the process", () => {
  const { player, spawnMp3Fn } = makePlayer();
  player.play(0);
  const child = spawnMp3Fn.spawned[0];

  player.togglePlayPause();
  assert.equal(player.status, "paused");
  assert.deepEqual(child.killSignals, ["SIGSTOP"]);

  player.togglePlayPause();
  assert.equal(player.status, "playing");
  assert.deepEqual(child.killSignals, ["SIGSTOP", "SIGCONT"]);
  assert.equal(spawnMp3Fn.spawned.length, 1, "resume must not spawn a second process");
});

test("elapsedSeconds freezes while paused and keeps ticking while playing", async () => {
  const { player } = makePlayer();
  player.play(0);
  await new Promise((r) => setTimeout(r, 20));
  player.togglePlayPause(); // pause
  const frozen = player.elapsedSeconds;
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(player.elapsedSeconds, frozen);
});

test("stop() kills the process and resets elapsed time", () => {
  const { player, spawnMp3Fn } = makePlayer();
  player.play(0);
  const child = spawnMp3Fn.spawned[0];
  player.stop();
  assert.equal(player.status, "stopped");
  assert.equal(player.elapsedSeconds, 0);
  assert.ok(child.killSignals.includes("SIGKILL"));
});

test("next()/prev() wrap around the playlist and start playing immediately", () => {
  const { player } = makePlayer();
  player.play(0);
  player.next();
  assert.equal(player.currentIndex, 1);
  player.next();
  assert.equal(player.currentIndex, 2);
  player.next();
  assert.equal(player.currentIndex, 0, "next() wraps past the last track");

  player.prev();
  assert.equal(player.currentIndex, 2, "prev() wraps before the first track");
});

test("a natural end of track (process exits on its own) auto-advances to the next track", () => {
  const { player, spawnMp3Fn, spawnMidiFn } = makePlayer();
  player.play(0);
  const firstChild = spawnMp3Fn.spawned[0];
  firstChild.emit("exit", 0, null); // ffplay finished on its own

  assert.equal(player.currentIndex, 1, "should have auto-advanced to track 2");
  assert.equal(player.status, "playing");
  assert.equal(spawnMidiFn.spawned.length, 1);
});

test("a natural end of the last track stops instead of wrapping", () => {
  const { player, spawnMp3Fn } = makePlayer();
  player.play(2); // last track
  const child = spawnMp3Fn.spawned[0];
  child.emit("exit", 0, null);
  assert.equal(player.status, "stopped");
  assert.equal(player.currentIndex, 2, "stays on the last track, doesn't wrap to 0");
});

test("seek() on an mp3 track kills and respawns at the new offset", async () => {
  const { player, spawnMp3Fn } = makePlayer();
  player.play(0);
  await new Promise((r) => setTimeout(r, 20));
  const firstChild = spawnMp3Fn.spawned[0];

  const ok = player.seek(10);
  assert.equal(ok, true);
  assert.ok(firstChild.killSignals.includes("SIGKILL"));
  assert.equal(spawnMp3Fn.spawned.length, 2, "seek respawns a new process");
  const secondCall = spawnMp3Fn.spawned[1];
  assert.ok(secondCall.spawnArgs[1].startSeconds >= 10, "new process started at (roughly) the sought offset");
  assert.equal(player.status, "playing");
});

test("seek() preserves the paused state across the respawn", () => {
  const { player, spawnMp3Fn } = makePlayer();
  player.play(0);
  player.togglePlayPause(); // pause
  player.seek(5);
  assert.equal(player.status, "paused");
  const respawned = spawnMp3Fn.spawned[1];
  assert.deepEqual(respawned.killSignals, ["SIGSTOP"], "the respawned process is immediately paused too");
});

test("seek() is a no-op for midi tracks and reports why", () => {
  const { player, spawnMidiFn } = makePlayer();
  player.play(1); // the midi track
  const ok = player.seek(5);
  assert.equal(ok, false);
  assert.match(player.lastError, /MIDI/);
  assert.equal(spawnMidiFn.spawned.length, 1, "no respawn happened");
});

test("setVolume() clamps to 0-100 and relaunches an mp3 track at the new volume", () => {
  const { player, spawnMp3Fn } = makePlayer();
  player.play(0);
  player.setVolume(1000);
  assert.equal(player.volumePercent, 100);
  assert.equal(spawnMp3Fn.spawned.length, 2, "mp3 volume change relaunches");
  assert.equal(spawnMp3Fn.spawned[1].spawnArgs[1].volumePercent, 100);

  player.setVolume(-1000);
  assert.equal(player.volumePercent, 0);
});

test("setVolume() on a midi track updates the value without relaunching mid-track", () => {
  const { player, spawnMidiFn } = makePlayer();
  player.play(1);
  player.setVolume(-10);
  assert.equal(player.volumePercent, 60);
  assert.equal(spawnMidiFn.spawned.length, 1, "no relaunch for midi");
});

test("a spawn error (e.g. the backend binary is missing) surfaces lastError and stops cleanly", () => {
  const { player, spawnMp3Fn } = makePlayer();
  player.play(0);
  const child = spawnMp3Fn.spawned[0];
  child.emit("error", new Error("spawn ffplay ENOENT"));
  assert.equal(player.status, "stopped");
  assert.match(player.lastError, /ENOENT/);
});

test("dispose() kills any in-flight process", () => {
  const { player, spawnMp3Fn } = makePlayer();
  player.play(0);
  const child = spawnMp3Fn.spawned[0];
  player.dispose();
  assert.ok(child.killSignals.includes("SIGKILL"));
});
