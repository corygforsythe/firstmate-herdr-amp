#!/usr/bin/env node
// Action entrypoint (herdr-plugin.toml [[actions]] id = "open"). Two herdr
// 0.8.x quirks this works around — see AGENTS.md for how they were found:
//
// 1. `herdr plugin pane open --placement split` requires --target-pane (an
//    existing pane to split against) or it errors with invalid_params.
//    --target-pane and --workspace together also fail the same way, so we
//    only ever send one.
// 2. We deliberately never pass --cwd: that changes the actual process
//    working directory the pane's command is spawned in, and
//    herdr-plugin.toml's `command` arrays are relative paths
//    (bin/run-node.sh, src/amp-tui.mjs) resolved against that cwd — a --cwd
//    override breaks that resolution and the pane silently exits right
//    after opening.
//
// Unlike the sibling firstmate-herdr-muster-list plugin, there's no caller
// working directory to forward via --env either: the music library location
// comes from config.json's musicDir (or the bundled tracks/ default), never
// from wherever the user happened to invoke this action from.
import { spawnSync } from "node:child_process";

function readContext() {
  const raw = process.env.HERDR_PLUGIN_CONTEXT_JSON;
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function main() {
  const ctx = readContext();
  const bin = process.env.HERDR_BIN_PATH || "herdr";
  const pluginId = process.env.HERDR_PLUGIN_ID;
  const targetPane = ctx.focused_pane_id || process.env.HERDR_PANE_ID;

  const args = [
    "plugin",
    "pane",
    "open",
    "--plugin",
    pluginId,
    "--entrypoint",
    "amp",
    "--placement",
    "split",
    "--direction",
    "right",
    "--focus",
  ];
  if (targetPane) {
    args.push("--target-pane", targetPane);
  } else if (process.env.HERDR_WORKSPACE_ID) {
    args.push("--workspace", process.env.HERDR_WORKSPACE_ID);
  }

  const result = spawnSync(bin, args, { stdio: "inherit" });
  if (result.error) {
    process.stderr.write(`open-amp: failed to invoke herdr: ${result.error.message}\n`);
    process.exit(1);
  }
  process.exit(result.status ?? 1);
}

main();
