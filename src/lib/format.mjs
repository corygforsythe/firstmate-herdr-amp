// Small display-formatting helpers shared by the interactive and
// non-interactive renderers in src/amp-tui.mjs.

export function formatTime(totalSeconds) {
  const safe = Number.isFinite(totalSeconds) && totalSeconds > 0 ? totalSeconds : 0;
  const whole = Math.floor(safe);
  const minutes = Math.floor(whole / 60);
  const seconds = whole % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

// Renders a WinAmp-style slider: a run of `fillChar` up to a single `knobChar`
// position, then `trackChar` for the rest — exactly `width` characters wide.
export function renderSlider(fraction, width, { fillChar = "=", knobChar = "o", trackChar = "-" } = {}) {
  const w = Math.max(1, Math.floor(width));
  const clamped = Math.max(0, Math.min(1, Number.isFinite(fraction) ? fraction : 0));
  const knobPos = Math.round(clamped * (w - 1));
  let out = "";
  for (let i = 0; i < w; i++) {
    if (i === knobPos) out += knobChar;
    else if (i < knobPos) out += fillChar;
    else out += trackChar;
  }
  return out;
}
