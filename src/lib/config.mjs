import fs from "node:fs";
import path from "node:path";

export const DEFAULT_VOLUME_PERCENT = 70;

const DEFAULTS = {
  // null means "use the bundled tracks/ directory" — resolved by the caller
  // (src/amp-tui.mjs), not here, since that default is relative to the
  // plugin's own root, not anything config.mjs knows about.
  musicDir: null,
  soundFontPath: null,
  defaultVolumePercent: DEFAULT_VOLUME_PERCENT,
};

// Reads $HERDR_PLUGIN_CONFIG_DIR/config.json, if present, for overrides.
// Missing file or invalid JSON silently falls back to defaults — this file
// is optional.
export function loadConfig(configDir) {
  const result = { ...DEFAULTS };
  if (!configDir) return result;
  const configPath = path.join(configDir, "config.json");
  try {
    const raw = fs.readFileSync(configPath, "utf8");
    const parsed = JSON.parse(raw);
    if (typeof parsed.musicDir === "string" && parsed.musicDir.trim()) {
      result.musicDir = parsed.musicDir.trim();
    }
    if (typeof parsed.soundFontPath === "string" && parsed.soundFontPath.trim()) {
      result.soundFontPath = parsed.soundFontPath.trim();
    }
    if (
      Number.isFinite(parsed.defaultVolumePercent) &&
      parsed.defaultVolumePercent >= 0 &&
      parsed.defaultVolumePercent <= 100
    ) {
      result.defaultVolumePercent = parsed.defaultVolumePercent;
    }
  } catch {
    // no config file, or it's malformed — defaults stand.
  }
  return result;
}
