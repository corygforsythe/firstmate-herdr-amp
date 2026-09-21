#!/bin/sh
# Herdr's plugin runtime can spawn commands with a minimal PATH (observed:
# /usr/bin:/bin:/usr/sbin:/sbin) that omits Homebrew, nvm, Volta, and
# ~/.local/bin — common places `node` actually lives. Extend PATH with
# those locations before delegating, so the manifest doesn't have to
# hardcode a machine-specific absolute node path.
for extra in /opt/homebrew/bin /usr/local/bin "$HOME/.local/bin" "$HOME/.volta/bin"; do
  case ":$PATH:" in
    *":$extra:"*) ;;
    *) [ -d "$extra" ] && PATH="$extra:$PATH" ;;
  esac
done
export PATH

script="$1"
shift
exec node "$script" "$@"
