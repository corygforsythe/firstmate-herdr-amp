// Spawns the external system player/synth processes that actually produce
// audio. See AGENTS.md for why these two specific tools were chosen and
// what each one can't do.
import { spawn } from "node:child_process";

const MAX_MIDI_GAIN = 1.5;

function clampPercent(value) {
  return Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
}

// ffplay (bundled with ffmpeg) plays MP3s. Unlike macOS's built-in `afplay`
// (which has no start-offset flag and no stdin support), ffplay's `-ss`
// gives this plugin a real seek, and `-volume` a real live-startup volume —
// see src/lib/player.mjs for how both features are built out of "kill and
// respawn at a new offset/volume", since ffplay itself can't be steered
// once running.
export function spawnMp3(filePath, { startSeconds = 0, volumePercent = 70 } = {}, spawnFn = spawn) {
  const args = ["-nodisp", "-autoexit", "-loglevel", "error", "-volume", String(Math.round(clampPercent(volumePercent)))];
  if (startSeconds > 0) args.push("-ss", String(startSeconds));
  args.push(filePath);
  return spawnFn("ffplay", args, { stdio: "ignore" });
}

// fluidsynth renders MIDI through a General MIDI SoundFont. `-a coreaudio`
// hardcodes macOS's audio driver (this plugin's platforms = ["macos"] in
// herdr-plugin.toml is a direct consequence — a Linux port would need this
// to become "alsa"/"pulseaudio" instead). `-ni` disables the interactive
// command shell and MIDI input driver, so it just plays the given file(s)
// and exits. There is no seek-to-offset equivalent to ffplay's `-ss` here —
// see src/lib/player.mjs's seek() for how that limitation is surfaced.
export function spawnMidi(filePath, soundFontPath, { volumePercent = 70 } = {}, spawnFn = spawn) {
  const gain = (clampPercent(volumePercent) / 100) * MAX_MIDI_GAIN;
  return spawnFn("fluidsynth", ["-a", "coreaudio", "-g", gain.toFixed(2), "-ni", soundFontPath, filePath], {
    stdio: "ignore",
  });
}
