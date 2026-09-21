#!/usr/bin/env node
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

import { loadConfig } from "./lib/config.mjs";
import { scanLibrary } from "./lib/library.mjs";
import { probeDuration } from "./lib/duration.mjs";
import { Player } from "./lib/player.mjs";
import { formatTime, renderSlider } from "./lib/format.mjs";
import { parseKeys, splitTrailingPartialEscape } from "./lib/input.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ESC = "\x1b";
const ENABLE_ALT_SCREEN = `${ESC}[?1049h`;
const DISABLE_ALT_SCREEN = `${ESC}[?1049l`;
const HIDE_CURSOR = `${ESC}[?25l`;
const SHOW_CURSOR = `${ESC}[?25h`;
const CLEAR_HOME = `${ESC}[2J${ESC}[H`;
const DIM = `${ESC}[2m`;
const RESET = `${ESC}[0m`;
const REVERSE = `${ESC}[7m`;
const BOLD = `${ESC}[1m`;

const TICK_MS = 500;
const STATUS_ICON = { playing: "▶", paused: "❚❚", stopped: "■" };

function resolveMusicDir(config) {
  if (config.musicDir) return path.resolve(config.musicDir);
  return path.join(__dirname, "..", "tracks");
}

function truncate(text, width) {
  if (width <= 0) return "";
  if (text.length <= width) return text;
  return text.slice(0, Math.max(0, width - 1)) + "…";
}

function renderFrame(player, musicDir, selectedIndex) {
  const width = process.stdout.columns || 78;
  const lines = [];
  lines.push(`${REVERSE} HERDR AMP ${RESET}`);
  lines.push(DIM + musicDir + RESET);
  lines.push("");

  const track = player.currentTrack;
  if (!track) {
    lines.push("No tracks found.");
    lines.push(DIM + `Drop .mp3 / .mid files into ${musicDir}` + RESET);
    lines.push(DIM + "or set musicDir in config.json." + RESET);
  } else {
    const elapsed = player.elapsedSeconds;
    const duration = track.durationSeconds;
    const icon = STATUS_ICON[player.status] || "?";
    lines.push(`${icon} ${truncate(track.name, Math.max(4, width - 4))}`);

    const barWidth = Math.max(10, width - 20);
    const fraction = duration ? elapsed / duration : 0;
    lines.push(`  [${renderSlider(fraction, barWidth)}]  ${formatTime(elapsed)} / ${duration ? formatTime(duration) : "--:--"}`);

    const volBarWidth = 12;
    lines.push(
      `  VOL [${renderSlider(player.volumePercent / 100, volBarWidth)}] ${String(player.volumePercent).padStart(3)}%` +
        `    ${track.kind.toUpperCase()}    ${player.status.toUpperCase()}`
    );
    if (player.lastError) lines.push(DIM + player.lastError + RESET);
  }

  lines.push("");
  lines.push("   |<<        >  /  ||        []        >>|");
  lines.push("    prev     play / pause     stop      next");
  lines.push("");
  lines.push(`${REVERSE} Playlist ${RESET}`);

  if (!player.tracks.length) {
    lines.push(DIM + "(empty)" + RESET);
  } else {
    player.tracks.forEach((t, i) => {
      const marker = i === selectedIndex ? "> " : "  ";
      const nowPlaying = i === player.currentIndex && player.status !== "stopped" ? "*" : " ";
      const num = String(i + 1).padStart(2, "0");
      const dur = t.durationSeconds ? formatTime(t.durationSeconds) : "--:--";
      const prefix = `${marker}${nowPlaying}${num}  `;
      const nameWidth = Math.max(4, width - prefix.length - dur.length - 1);
      const name = truncate(t.name, nameWidth);
      const body = `${prefix}${name}`;
      const line = body.padEnd(Math.max(body.length, width - dur.length)) + dur;
      lines.push(i === player.currentIndex ? BOLD + line + RESET : line);
    });
  }

  lines.push("");
  lines.push(
    DIM +
      "space play/pause · s stop · n/p next/prev · ←/→ seek ±5s · +/- volume · ↑/↓ select · enter play · q quit" +
      RESET
  );

  process.stdout.write(CLEAR_HOME + lines.join("\r\n"));
}

function renderPlainFrame(player, selectedIndex) {
  const out = [];
  out.push(`Herdr Amp — ${player.tracks.length} track(s)`);
  const track = player.currentTrack;
  if (track) {
    out.push(
      `${player.status.toUpperCase()}: ${track.name} [${formatTime(player.elapsedSeconds)} / ${
        track.durationSeconds ? formatTime(track.durationSeconds) : "--:--"
      }] vol=${player.volumePercent}%`
    );
  } else {
    out.push("No track loaded.");
  }
  if (player.lastError) out.push(`ERROR: ${player.lastError}`);
  player.tracks.forEach((t, i) => {
    const sel = i === selectedIndex ? ">" : " ";
    const now = i === player.currentIndex ? "*" : " ";
    out.push(`${sel}${now} ${i + 1}. ${t.name} (${t.durationSeconds ? formatTime(t.durationSeconds) : "--:--"})`);
  });
  process.stdout.write(out.join("\n") + "\n");
}

function runInteractive(player, musicDir) {
  let selectedIndex = player.currentIndex >= 0 ? player.currentIndex : 0;

  const render = () => renderFrame(player, musicDir, selectedIndex);
  player.onChange = render;

  process.stdout.write(ENABLE_ALT_SCREEN + HIDE_CURSOR);
  const restore = () => process.stdout.write(SHOW_CURSOR + DISABLE_ALT_SCREEN);

  const tickTimer = setInterval(() => {
    if (player.status === "playing") render();
  }, TICK_MS);
  tickTimer.unref?.();

  let cleanedUp = false;
  const cleanup = (code) => {
    if (cleanedUp) return;
    cleanedUp = true;
    clearInterval(tickTimer);
    player.dispose();
    restore();
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
    process.stdin.pause();
    process.exitCode = code ?? 0;
  };

  process.on("exit", restore);
  process.on("SIGINT", () => cleanup(0));
  process.on("SIGTERM", () => cleanup(0));
  if (process.stdout.isTTY) process.stdout.on("resize", render);

  function handleKey(key) {
    const n = player.tracks.length;
    switch (key) {
      case "up":
        if (n) selectedIndex = (selectedIndex - 1 + n) % n;
        render();
        break;
      case "down":
        if (n) selectedIndex = (selectedIndex + 1) % n;
        render();
        break;
      case "enter":
        if (n) player.play(selectedIndex);
        break;
      case "toggle":
        player.togglePlayPause();
        break;
      case "stop":
        player.stop();
        break;
      case "next":
        player.next();
        selectedIndex = player.currentIndex;
        break;
      case "prev":
        player.prev();
        selectedIndex = player.currentIndex;
        break;
      case "left":
        player.seek(-5);
        break;
      case "right":
        player.seek(5);
        break;
      case "volup":
        player.setVolume(5);
        break;
      case "voldown":
        player.setVolume(-5);
        break;
      case "quit":
        cleanup(0);
        return true;
      default:
        break;
    }
    return false;
  }

  let inputBuffer = "";
  process.stdin.setEncoding("utf8");
  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  process.stdin.on("data", (chunk) => {
    inputBuffer += chunk;
    const { complete, partial } = splitTrailingPartialEscape(inputBuffer);
    inputBuffer = partial;
    for (const key of parseKeys(complete)) {
      if (handleKey(key)) return;
    }
  });

  render();
}

function runNonInteractive(player) {
  let selectedIndex = player.currentIndex >= 0 ? player.currentIndex : 0;
  const renderPlain = () => renderPlainFrame(player, selectedIndex);
  player.onChange = renderPlain;

  const rl = readline.createInterface({ input: process.stdin, terminal: false });
  renderPlain();
  rl.on("line", (line) => {
    const cmd = line.trim();
    const n = player.tracks.length;
    if (cmd === "up" && n) selectedIndex = (selectedIndex - 1 + n) % n;
    else if (cmd === "down" && n) selectedIndex = (selectedIndex + 1) % n;
    else if (cmd === "enter" && n) player.play(selectedIndex);
    else if (cmd === "toggle") player.togglePlayPause();
    else if (cmd === "stop") player.stop();
    else if (cmd === "next") {
      player.next();
      selectedIndex = player.currentIndex;
    } else if (cmd === "prev") {
      player.prev();
      selectedIndex = player.currentIndex;
    } else if (cmd === "seek+5") player.seek(5);
    else if (cmd === "seek-5") player.seek(-5);
    else if (cmd === "vol+5") player.setVolume(5);
    else if (cmd === "vol-5") player.setVolume(-5);
    else if (cmd === "quit") {
      rl.close();
      return;
    }
    renderPlain();
  });
  rl.on("close", () => {
    player.dispose();
    process.exit(0);
  });
}

function main() {
  const configDir = process.env.HERDR_PLUGIN_CONFIG_DIR;
  const config = loadConfig(configDir);
  const musicDir = resolveMusicDir(config);
  const tracks = scanLibrary(musicDir, probeDuration);

  const player = new Player(tracks, { soundFontPath: config.soundFontPath });
  player.volumePercent = config.defaultVolumePercent;

  if (process.stdin.isTTY && process.stdout.isTTY) {
    runInteractive(player, musicDir);
  } else {
    runNonInteractive(player);
  }
}

main();
