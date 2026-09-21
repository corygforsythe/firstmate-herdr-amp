// The transport state machine: play/pause/stop/prev/next/seek/volume, built
// on top of one-shot child-process backends (see src/lib/backends.mjs) that
// have no live control channel of their own. Two techniques carry the whole
// design:
//
// - Pause/resume sends SIGSTOP/SIGCONT directly to the backend's own OS
//   process, rather than anything backend-specific — verified empirically
//   (see AGENTS.md) to actually freeze/resume audio output cleanly for a
//   simple foreground player like ffplay or fluidsynth.
// - Seek and mid-playback volume changes (for backends that support neither
//   live) are implemented as "kill the current process, respawn at a new
//   offset/volume". This works cleanly for MP3 (ffplay's `-ss` gives a real
//   start offset); MIDI has no equivalent, so seek is unsupported for MIDI
//   tracks and volume changes for MIDI only take effect on the next
//   (re)start rather than relaunching mid-track — see setVolume() below.
import { spawnMp3, spawnMidi } from "./backends.mjs";

const DEFAULT_VOLUME_PERCENT = 70;

export class Player {
  constructor(tracks, { soundFontPath = null, spawnMp3Fn = spawnMp3, spawnMidiFn = spawnMidi, onChange = () => {} } = {}) {
    this.tracks = tracks;
    this.soundFontPath = soundFontPath;
    this.spawnMp3Fn = spawnMp3Fn;
    this.spawnMidiFn = spawnMidiFn;
    this.onChange = onChange;

    this.currentIndex = tracks.length ? 0 : -1;
    this.status = "stopped"; // "stopped" | "playing" | "paused"
    this.volumePercent = DEFAULT_VOLUME_PERCENT;
    this.elapsedBaseSeconds = 0;
    this.playStartedAt = null;
    this.child = null;
    this.lastError = null;
  }

  get currentTrack() {
    return this.currentIndex >= 0 ? this.tracks[this.currentIndex] : null;
  }

  get elapsedSeconds() {
    if (this.status === "playing" && this.playStartedAt != null) {
      return this.elapsedBaseSeconds + (Date.now() - this.playStartedAt) / 1000;
    }
    return this.elapsedBaseSeconds;
  }

  _killChild(child) {
    if (!child) return;
    // Tagging the child itself (rather than an instance-level flag) means
    // two overlapping kill/respawn cycles (e.g. a fast double seek) can
    // never cross-wire which exit event belongs to which kill.
    child.__killedIntentionally = true;
    try {
      child.kill("SIGKILL");
    } catch {
      // already exited
    }
  }

  _handleExit(child) {
    if (child.__killedIntentionally) return;
    if (this.child !== child) return; // stale reference from an old track
    this.child = null;
    // Natural end of track: advance, or stop after the last one. WinAmp's
    // classic behavior (continue through the playlist, stop at the end)
    // rather than looping.
    if (this.currentIndex >= this.tracks.length - 1) {
      this.stop();
    } else {
      this.next();
    }
  }

  _startChild(offsetSeconds, { paused = false } = {}) {
    const track = this.currentTrack;
    this.lastError = null;
    if (!track) {
      this.status = "stopped";
      return;
    }

    let child;
    if (track.kind === "mp3") {
      child = this.spawnMp3Fn(track.filePath, { startSeconds: offsetSeconds, volumePercent: this.volumePercent });
    } else {
      if (!this.soundFontPath) {
        this.lastError = "Set soundFontPath in config.json to play MIDI tracks.";
        this.status = "stopped";
        this.child = null;
        this.elapsedBaseSeconds = 0;
        this.playStartedAt = null;
        return;
      }
      child = this.spawnMidiFn(track.filePath, this.soundFontPath, { volumePercent: this.volumePercent });
    }

    child.on("exit", () => this._handleExit(child));
    child.on("error", (err) => {
      if (child.__killedIntentionally) return;
      this.lastError = `Failed to start player: ${err.message}`;
      if (this.child === child) {
        this.child = null;
        this.status = "stopped";
        this.onChange();
      }
    });

    this.child = child;
    this.elapsedBaseSeconds = offsetSeconds;
    if (paused) {
      try {
        child.kill("SIGSTOP");
      } catch {
        // ignore — a same-tick spawn error is handled by the "error" listener above
      }
      this.status = "paused";
      this.playStartedAt = null;
    } else {
      this.status = "playing";
      this.playStartedAt = Date.now();
    }
  }

  play(index = this.currentIndex) {
    if (index < 0 || index >= this.tracks.length) return;
    this._killChild(this.child);
    this.currentIndex = index;
    this._startChild(0);
    this.onChange();
  }

  togglePlayPause() {
    if (this.status === "playing") {
      this.elapsedBaseSeconds = this.elapsedSeconds;
      this.playStartedAt = null;
      this.status = "paused";
      if (this.child) {
        try {
          this.child.kill("SIGSTOP");
        } catch {
          // already exited
        }
      }
    } else if (this.status === "paused") {
      this.playStartedAt = Date.now();
      this.status = "playing";
      if (this.child) {
        try {
          this.child.kill("SIGCONT");
        } catch {
          // already exited
        }
      }
    } else if (this.currentTrack) {
      this.play(this.currentIndex);
      return; // play() already called onChange()
    }
    this.onChange();
  }

  stop() {
    this._killChild(this.child);
    this.child = null;
    this.status = "stopped";
    this.elapsedBaseSeconds = 0;
    this.playStartedAt = null;
    this.onChange();
  }

  next() {
    if (!this.tracks.length) return;
    this.play((this.currentIndex + 1) % this.tracks.length);
  }

  prev() {
    if (!this.tracks.length) return;
    this.play((this.currentIndex - 1 + this.tracks.length) % this.tracks.length);
  }

  // Returns true if the seek actually took effect. MIDI tracks can't seek —
  // see the module-level comment — so this is always false for them.
  seek(deltaSeconds) {
    const track = this.currentTrack;
    if (!track || this.status === "stopped") return false;
    if (track.kind !== "mp3") {
      this.lastError = "Seeking isn't supported for MIDI tracks.";
      this.onChange();
      return false;
    }
    const duration = Number.isFinite(track.durationSeconds) ? track.durationSeconds : Infinity;
    const newOffset = Math.max(0, Math.min(duration, this.elapsedSeconds + deltaSeconds));
    const wasPaused = this.status === "paused";
    this._killChild(this.child);
    this._startChild(newOffset, { paused: wasPaused });
    this.onChange();
    return true;
  }

  setVolume(deltaPercent) {
    this.volumePercent = Math.max(0, Math.min(100, this.volumePercent + deltaPercent));
    const track = this.currentTrack;
    // MP3 (ffplay) relaunches seamlessly at the same offset with the new
    // volume. MIDI has no such offset to relaunch at without an audible
    // restart-from-0 gap, so its volume change is deferred to the next
    // (re)start instead — documented in README.md, not a bug.
    if (track && track.kind === "mp3" && this.status !== "stopped") {
      const wasPaused = this.status === "paused";
      const offset = this.elapsedSeconds;
      this._killChild(this.child);
      this._startChild(offset, { paused: wasPaused });
    }
    this.onChange();
  }

  dispose() {
    this._killChild(this.child);
    this.child = null;
  }
}
