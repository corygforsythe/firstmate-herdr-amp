// The real getDuration(filePath, kind) used by src/amp-tui.mjs — isolated
// from src/lib/library.mjs so tests can inject a fake instead of needing
// ffprobe installed or real MIDI files on disk.
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { getMidiDurationSeconds } from "./midi.mjs";

export function probeDuration(filePath, kind) {
  try {
    if (kind === "midi") {
      return getMidiDurationSeconds(fs.readFileSync(filePath));
    }
    if (kind === "mp3") {
      // ffprobe ships alongside ffplay in the same ffmpeg install this
      // plugin already requires for MP3 playback (see src/lib/backends.mjs).
      const out = execFileSync(
        "ffprobe",
        ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", filePath],
        { encoding: "utf8" }
      );
      const seconds = parseFloat(out);
      return Number.isFinite(seconds) ? seconds : null;
    }
  } catch {
    // ffprobe/ffmpeg missing, or the file is unreadable/malformed — the UI
    // shows "--:--" for an unknown duration rather than crashing.
    return null;
  }
  return null;
}
