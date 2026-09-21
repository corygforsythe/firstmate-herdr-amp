# firstmate-herdr-amp

**Herdr Amp** is a [Herdr](https://herdr.dev) plugin: a WinAmp-style terminal
pane for playing **MP3** and **MIDI** files, complete with transport controls
(play/pause/stop/prev/next), a seek/progress bar, a volume control, and a
playlist showing each track's name and elapsed/total time.

```
 HERDR AMP
/path/to/your/tracks

▶ Sunset Drive
  [================o-----------------------------------------]  00:01 / 00:05
  VOL [=======o----]  60%    MP3    PLAYING

   |<<        >  /  ||        []        >>|
    prev     play / pause     stop      next

 Playlist
   01  Chiptune Loop                                                    00:01
> *02  Sunset Drive                                                     00:05

space play/pause · s stop · n/p next/prev · ←/→ seek ±5s · +/- volume · ↑/↓ select · enter play · q quit
```

## Platform and dependencies — read this before installing

**macOS (Darwin) only**, and it needs two external command-line tools
installed separately — this plugin ships no audio decoding or synthesis of
its own, it just shells out to them:

| Format | Tool | Install | Why |
| --- | --- | --- | --- |
| MP3 | `ffplay` (part of [ffmpeg](https://ffmpeg.org)) | `brew install ffmpeg` | Unlike macOS's built-in `afplay`, `ffplay` supports a real seek-to-offset and a real startup volume — that's what makes the seek bar and volume control actually do something for MP3 tracks. |
| MIDI | [`fluidsynth`](https://www.fluidsynth.org) + a General MIDI **SoundFont** (`.sf2`) file | `brew install fluid-synth`, then download a `.sf2` (e.g. search for "GeneralUser GS" or "FluidR3_GM") | MIDI files contain no audio, only note events — something has to synthesize them, and neither macOS nor ffmpeg ships a General MIDI synth. `fluidsynth` is invoked with `-a coreaudio`, hardcoding macOS's audio driver. |

If `ffplay` is missing, MP3 tracks fail to start with a clear on-screen
error instead of crashing the pane. If `soundFontPath` isn't configured (see
below), MIDI tracks show "Set soundFontPath in config.json to play MIDI
tracks." instead of attempting to play. See [AGENTS.md](AGENTS.md) for the
full rationale and the resulting playback limitations (seek and mid-track
volume changes work differently for MP3 vs. MIDI).

## Quick Start

```sh
brew install ffmpeg fluid-synth   # see the dependency table above
herdr --version                   # confirm the CLI is present
herdr plugin link "$(pwd)"        # link this checkout as a local plugin
herdr plugin list --json          # sanity-check it loaded and parsed
```

Run the "Open Herdr Amp" plugin action to open the pane (or, from a shell:
`herdr plugin action invoke open --plugin dev.coryforsythe.firstmate-herdr-amp`).
It opens as a new pane split to the right. Remove it later with `herdr
plugin unlink dev.coryforsythe.firstmate-herdr-amp`.

### Adding tracks

Drop `.mp3` / `.mid` / `.midi` files directly into this plugin's `tracks/`
directory (it's gitignored, so your music never gets committed), or point
`musicDir` in the config at any folder you like:

```json
{
  "musicDir": "/absolute/path/to/your/music",
  "soundFontPath": "/absolute/path/to/a/General-MIDI.sf2",
  "defaultVolumePercent": 70
}
```

Save that as `$HERDR_PLUGIN_CONFIG_DIR/config.json` (find the directory with
`herdr plugin config-dir dev.coryforsythe.firstmate-herdr-amp`) — see
`config.example.json` in this repo for a starting point.

- **`musicDir`** *(default: this plugin's own `tracks/` folder)* — the
  folder scanned for tracks. Not recursive — a flat "drop files in here"
  folder.
- **`soundFontPath`** *(no default — required for MIDI playback)* — an
  absolute path to a General MIDI `.sf2` SoundFont file for `fluidsynth` to
  use. MIDI tracks still show up in the playlist (with a computed duration)
  without this set; they just can't be played yet.
- **`defaultVolumePercent`** *(default `70`)* — starting volume, 0-100.

## Using it

- **Keyboard**: `↑`/`↓` moves the playlist selection, `enter` plays the
  selected track, `space` toggles play/pause (or starts the selected track
  if stopped), `s` stops, `n`/`p` jump to the next/previous track (wrapping
  around the playlist), `←`/`→` seeks -5s/+5s, `+`/`-` adjusts volume, `q` or
  `Ctrl+C` quits.
- Reaching the end of a track auto-advances to the next one; reaching the
  end of the last track stops instead of looping.
- If stdin/stdout aren't a TTY (piped, e.g. in CI), the pane falls back to a
  plain-text, line-oriented mode (`up` / `down` / `enter` / `toggle` / `stop`
  / `next` / `prev` / `seek+5` / `seek-5` / `vol+5` / `vol-5` / `quit`
  commands over stdin) instead of raw-mode ANSI.
- **Seeking and volume behave differently for MP3 vs. MIDI** — see "The
  playback model" in [AGENTS.md](AGENTS.md) for exactly why: MP3 seeking and
  mid-track volume changes are seamless; MIDI seeking is unsupported, and
  MIDI volume changes only take effect the next time that track starts.

## What's here

- `herdr-plugin.toml` — the plugin manifest: one `[[actions]]` entry ("Open
  Herdr Amp") that opens one `[[panes]]` entry (`amp`, pane title "Amp") as
  a `split` pane.
- `bin/open-amp.mjs` — the action's command, opening the split pane.
- `bin/run-node.sh` — a tiny PATH-fixing wrapper both manifest commands go
  through (see [AGENTS.md](AGENTS.md) for the environment quirk it works
  around).
- `src/amp-tui.mjs` — the pane program: a zero-npm-dependency Node TUI.
- `src/lib/` — pure, unit-tested logic: `player.mjs` (the transport state
  machine), `backends.mjs` (spawns `ffplay`/`fluidsynth`), `library.mjs`
  (scans `musicDir` for tracks), `duration.mjs` (the real duration lookup —
  `ffprobe` for MP3, `midi.mjs`'s own parser for MIDI), `midi.mjs` (a
  minimal Standard MIDI File reader, just enough to compute a track's
  duration), `format.mjs` (time/slider rendering), `input.mjs` (keyboard
  parsing), `config.mjs` (the optional plugin config file).
- `test/` — `node --test` unit tests for everything in `src/lib/`, plus an
  integration test that spawns the real `src/amp-tui.mjs` entrypoint in its
  non-interactive fallback mode. Run with `npm test`.
- `tracks/` — the default (gitignored) place to drop your own audio files.
- `.github/workflows/ci.yml` — runs `npm ci`, `npm run lint` (syntax-checks
  every `.mjs` file — no linter dependency), and `npm test` on push to
  `main` and on every pull request. Runs on `ubuntu-latest`; the test suite
  never actually invokes `ffplay`/`fluidsynth` (see AGENTS.md), so it
  doesn't need macOS or either dependency installed to pass.

No runtime npm dependencies and no build step — just Node's standard
library plus the two external system binaries in the table above.
`node >= 18` required.

See [AGENTS.md](AGENTS.md) for contributor-facing notes: the herdr 0.8.x
plugin-runtime quirks worked around in `bin/`, and the full playback-model
rationale (why ffplay/fluidsynth, why seek/volume behave differently per
format, how pause/resume actually works).
