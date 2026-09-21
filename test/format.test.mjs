import { test } from "node:test";
import assert from "node:assert/strict";
import { formatTime, renderSlider } from "../src/lib/format.mjs";

test("formatTime pads minutes/seconds to two digits", () => {
  assert.equal(formatTime(0), "00:00");
  assert.equal(formatTime(5), "00:05");
  assert.equal(formatTime(65), "01:05");
  assert.equal(formatTime(3661), "61:01");
});

test("formatTime treats negative/NaN/undefined as zero", () => {
  assert.equal(formatTime(-5), "00:00");
  assert.equal(formatTime(NaN), "00:00");
  assert.equal(formatTime(undefined), "00:00");
});

test("renderSlider places the knob at the start/end for fraction 0/1", () => {
  assert.equal(renderSlider(0, 10), "o---------");
  assert.equal(renderSlider(1, 10), "=========o");
});

test("renderSlider places the knob proportionally in the middle", () => {
  assert.equal(renderSlider(0.5, 11), "=====o-----");
});

test("renderSlider clamps out-of-range and non-finite fractions", () => {
  assert.equal(renderSlider(-1, 5), "o----");
  assert.equal(renderSlider(2, 5), "====o");
  assert.equal(renderSlider(NaN, 5), "o----");
});

test("renderSlider always returns exactly `width` characters", () => {
  for (const w of [1, 2, 5, 40]) {
    assert.equal(renderSlider(0.37, w).length, w);
  }
});
