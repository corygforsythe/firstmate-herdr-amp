# Project agent memory

This file is the project's committed home for project-intrinsic agent
knowledge: build, test, release, architecture, and sharp-edge notes that
should travel with the code.

- Add durable project-specific notes here as they are discovered through
  real work.
- Run tests with `npm test` (`node --test`). Lint is `npm run lint`
  (`node --check` on every `.mjs` file — no linter dependency).
- Two herdr 0.8.x plugin-runtime quirks, shared with the sibling
  `firstmate-herdr-muster-list` plugin (see its `AGENTS.md` for the original
  write-up) — read before touching `herdr-plugin.toml`, `bin/open-amp.mjs`,
  or `bin/run-node.sh`:
  1. **`herdr plugin pane open --placement split` requires `--target-pane`**
     (or it errors `invalid_params`), and `--target-pane`/`--workspace`
     together also fail — `bin/open-amp.mjs` only ever sends one.
  2. **The plugin runtime's `PATH` can be minimal** (observed:
     `/usr/bin:/bin:/usr/sbin:/sbin`, no Homebrew). `bin/run-node.sh`
     extends `PATH` before `exec node "$@"`; both manifest `command` arrays
     go through it. This also matters for the pane process finding
     `ffplay`/`fluidsynth` at runtime (both live under `/opt/homebrew/bin`
     on Apple Silicon) — if playback fails with an on-screen "Failed to
     start player: spawn ... ENOENT" even though the tool is installed,
     check this first.
  3. Unlike `firstmate-herdr-muster-list`, `bin/open-amp.mjs` never passes
     `--cwd` **and never needs to forward a working directory via `--env`
     either** — the music library location comes from `config.json`'s
     `musicDir` (default: this plugin's own `tracks/` folder, resolved via
     `import.meta.url`), never from wherever the calling pane happened to
     be. Don't add `--cwd` back if it seems convenient later; it breaks
     `bin/run-node.sh`'s relative-path resolution the same way it does for
     muster-list.

## The playback model

Node has no built-in cross-format audio player, so this plugin shells out to
two different one-shot system processes, chosen after checking what's
actually available (`brew info`, `ffmpeg -decoders`) rather than assumed:

- **MP3 → `ffplay`** (from `ffmpeg`). Chosen over macOS's built-in `afplay`
  specifically because `afplay` has no start-offset flag and doesn't accept
  stdin — verified directly (`afplay -` errors "unknown argument: -", and
  there's no `-ss`-equivalent) — so it can't support a real seek or a
  volume change without either losing playback position or requiring an
  external decode step. `ffplay -nodisp -autoexit -volume N [-ss OFFSET]
  file.mp3` gives a real, verified-working headless player with both.
- **MIDI → `fluidsynth -a coreaudio -g GAIN -ni SOUNDFONT file.mid`**.
  Checked and ruled out first: `ffmpeg`/`ffplay` (confirmed via `ffmpeg
  -decoders`/`-demuxers`) has **no General MIDI synthesizer** — it can only
  read Standard MIDI Files as a raw byte-dump format (`sds`), not render
  them to audio. `timidity`/`wildmidi` were considered and rejected: both
  need a separately-sourced GUS-compatible patch set with no Homebrew
  formula bundling one, which is *more* setup friction than fluidsynth +
  a single downloaded `.sf2` SoundFont, for lower audio quality. `-a
  coreaudio` hardcodes macOS's audio driver — this is why
  `herdr-plugin.toml` declares `platforms = ["macos"]`; a Linux port would
  need that flag to become `alsa`/`pulseaudio` based on platform detection.

**Neither backend exposes a live control channel** — no pause, seek, or
volume command you can send to a running process. Every interactive feature
in `src/lib/player.mjs` is built from exactly two primitives:

1. **Pause/resume = `SIGSTOP`/`SIGCONT` sent directly to the backend's own
   OS process.** Verified empirically, not assumed: a real Node
   `child_process.spawn("afplay", ...)`, stopped for 1s then resumed,
   produced `exit after 3.96s` for a 3s clip (0.5s played + 1s frozen +
   ~2.46s remaining) with `code: 0, signal: null` — i.e. audio genuinely
   freezes and resumes, and the process exits cleanly afterward. This is
   why `togglePlayPause()` never kills/respawns the child.
2. **Seek and mid-track volume changes = kill the current process, respawn
   at a new offset/volume.** Only works when the backend has an
   offset-capable flag. `ffplay`'s `-ss` makes this genuinely seamless for
   MP3. `fluidsynth` has no equivalent, so:
   - `Player.seek()` is a documented no-op for MIDI tracks (returns
     `false`, sets `lastError`) rather than faking a seek by restarting
     from 0.
   - `Player.setVolume()` on a MIDI track updates `volumePercent` but does
     **not** relaunch mid-track (that would restart the track from 0 with
     an audible gap) — the new volume only takes effect the next time that
     track, or another, is started. This is an intentional UX trade-off,
     not a bug — don't "fix" it by relaunching without re-reading this
     note.
   Each spawned child is tagged (`child.__killedIntentionally`) at the
   moment it's deliberately killed, checked in that *specific* child's own
   `exit` handler — not a shared instance-level flag — so two overlapping
   kill/respawn cycles (e.g. a fast double seek) can't cross-wire which
   `exit` event belongs to which kill and misfire the natural-end-of-track
   auto-advance logic.

`src/lib/midi.mjs` is a minimal Standard MIDI File reader — not a general
MIDI library, and it doesn't touch note content at all. It exists purely to
answer "how long does this file play for" (walking delta-times and Set
Tempo meta-events) since `fluidsynth`'s CLI has no simple way to report
that. SMPTE-based timecode division (rare for General MIDI files) falls back
to an assumed 480 ticks/quarter rather than doing the frames/sec math — a
documented approximation.

## Testing without the real dependencies installed

CI (`ubuntu-latest`) has neither `ffplay` nor `fluidsynth`, and even on a
dev machine that has them, tests should never trigger real audio playback
as a side effect. Two techniques keep the suite deterministic and silent:

- `test/player.test.mjs` injects fake `spawnMp3Fn`/`spawnMidiFn` (plain
  `EventEmitter`s with a recording `.kill()`) into `Player` instead of
  touching `src/lib/backends.mjs`'s real `spawn()` calls — see
  `makeFakeSpawner()`. A "natural end of track" is simulated by calling
  `fakeChild.emit("exit")` directly, exactly mirroring how a real
  `ffplay`/`fluidsynth` process signals completion.
- `test/amp-tui.integration.test.mjs` spawns the *real* `src/amp-tui.mjs`
  entrypoint (not a fake), but with `PATH` deliberately restricted to
  `/usr/bin:/bin` — guaranteeing `ffplay` isn't found, so attempting to play
  an MP3 fixture deterministically hits `Player`'s "Failed to start player:
  ... ENOENT" path instead of either flaking (dependent on what's installed
  on the machine running the test) or actually playing audio.

This was manually verified end-to-end once, beyond the automated suite: a
real pty session (Python's `pty.fork`) driving the real interactive TUI
against a real synthetic MP3 (via `ffmpeg -f lavfi`) and a hand-built
minimal MIDI file, confirming the rendered progress bar and elapsed-time
readout actually advance during real `ffplay` playback, volume/seek/pause/
stop/track-switching all work, and selecting a MIDI track with no
`soundFontPath` configured shows the friendly error instead of crashing.
That session isn't captured as an automated test (real audio playback isn't
something CI should do) — see git/PR history if this needs re-verifying
after a future change to the playback model.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in
this project. Do not repeat what the codebase already shows; point to the
authoritative file or command instead. Prefer rewriting or pruning existing
entries over appending new ones. When updating this file, preserve this bar
for all agents and keep entries concise.
