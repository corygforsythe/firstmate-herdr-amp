// Builds the playlist by scanning a directory for supported audio files.
// Non-recursive by design — a flat "drop files in here" folder, not a music
// library manager.
import fs from "node:fs";
import path from "node:path";

export const SUPPORTED_EXTENSIONS = {
  ".mp3": "mp3",
  ".mid": "midi",
  ".midi": "midi",
};

export function prettyTrackName(fileName) {
  const base = path.basename(fileName, path.extname(fileName));
  const spaced = base.replace(/[_-]+/g, " ").trim();
  return spaced || base;
}

// getDuration(filePath, kind) -> number seconds | null. Injected rather than
// called directly so this stays unit-testable without shelling out to
// ffprobe or reading real MIDI files — see src/lib/duration.mjs for the real
// implementation used by src/amp-tui.mjs.
export function scanLibrary(dir, getDuration) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const tracks = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name).toLowerCase();
    const kind = SUPPORTED_EXTENSIONS[ext];
    if (!kind) continue;
    const filePath = path.join(dir, entry.name);
    tracks.push({
      filePath,
      name: prettyTrackName(entry.name),
      kind,
      durationSeconds: getDuration(filePath, kind),
    });
  }
  tracks.sort((a, b) => a.name.localeCompare(b.name));
  return tracks;
}
