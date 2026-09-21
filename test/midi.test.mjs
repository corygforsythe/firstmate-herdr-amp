import { test } from "node:test";
import assert from "node:assert/strict";
import { getMidiDurationSeconds } from "../src/lib/midi.mjs";

function header(division, { ntrks = 1, format = 0 } = {}) {
  const buf = Buffer.alloc(14);
  buf.write("MThd", 0, "ascii");
  buf.writeUInt32BE(6, 4);
  buf.writeUInt16BE(format, 8);
  buf.writeUInt16BE(ntrks, 10);
  buf.writeUInt16BE(division, 12);
  return buf;
}

function track(bytes) {
  const body = Buffer.from(bytes);
  const head = Buffer.alloc(8);
  head.write("MTrk", 0, "ascii");
  head.writeUInt32BE(body.length, 4);
  return Buffer.concat([head, body]);
}

test("computes duration using an explicit Set Tempo meta-event", () => {
  // division = 96 ticks/quarter. Tempo set to 500000 (120 BPM) at tick 0.
  // End of track 100 ticks later -> (100/96) * 0.5s = 0.520833...s
  const buf = Buffer.concat([
    header(96),
    track([
      0x00, 0xff, 0x51, 0x03, 0x07, 0xa1, 0x20, // delta 0, tempo 500000
      0x64, 0xff, 0x2f, 0x00, // delta 100, end of track
    ]),
  ]);
  const duration = getMidiDurationSeconds(buf);
  assert.ok(Math.abs(duration - 100 / 96 / 2) < 1e-6);
});

test("falls back to the MIDI spec default tempo (120 BPM) when no Set Tempo event is present", () => {
  // division = 96 ticks/quarter, 192 ticks total -> 2 quarter notes at 120
  // BPM (0.5s/quarter) = 1.0s exactly.
  const buf = Buffer.concat([
    header(96),
    track([
      0x81, 0x40, 0xff, 0x2f, 0x00, // delta 192 (VLQ), end of track
    ]),
  ]);
  assert.equal(getMidiDurationSeconds(buf), 1.0);
});

test("uses the max end tick across multiple tracks (format 1 style)", () => {
  const buf = Buffer.concat([
    header(96, { ntrks: 2, format: 1 }),
    track([0x64, 0xff, 0x2f, 0x00]), // 100 ticks, default tempo -> 100/96/2s
    track([0x81, 0x40, 0xff, 0x2f, 0x00]), // 192 ticks -> 1.0s, the longer one
  ]);
  assert.equal(getMidiDurationSeconds(buf), 1.0);
});

test("applies a later tempo change only to the ticks after it", () => {
  // 96 ticks/quarter. First 96 ticks at default 500000 (0.5s), then tempo
  // drops to 250000 (twice as fast, 0.25s/quarter) for the next 96 ticks.
  // Total = 0.5 + 0.25 = 0.75s.
  const buf = Buffer.concat([
    header(96),
    track([
      0x60, 0xff, 0x51, 0x03, 0x03, 0xd0, 0x90, // delta 96, tempo -> 250000
      0x60, 0xff, 0x2f, 0x00, // delta 96, end of track
    ]),
  ]);
  const duration = getMidiDurationSeconds(buf);
  assert.ok(Math.abs(duration - 0.75) < 1e-6);
});

test("returns null for a buffer that isn't a Standard MIDI File", () => {
  assert.equal(getMidiDurationSeconds(Buffer.from("not a midi file at all")), null);
  assert.equal(getMidiDurationSeconds(Buffer.from([0x00, 0x01])), null);
});
