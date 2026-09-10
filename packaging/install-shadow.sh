#!/bin/sh
# Install a versioned local evaluation directory; no sudo or global registration.
set -eu
umask 077
RLSOK_SHADOW_VERSION='1.5.0-shadow.5'
ARCHIVE="rlsok-shadow-evaluation-${RLSOK_SHADOW_VERSION}-linux-x64.tar.gz"
BASE="https://github.com/realitywarden/rlsok/releases/download/v${RLSOK_SHADOW_VERSION}"
fail() { echo "RLSOK Shadow install: $1" >&2; exit 1; }
[ "$(uname -s)" = Linux ] && [ "$(uname -m)" = x86_64 ] || fail 'Linux x86_64 is required.'
[ -r /etc/os-release ] || fail '/etc/os-release is required.'
. /etc/os-release
[ "${ID:-}" = ubuntu ] || fail 'This evaluation package targets Ubuntu.'
case "${VERSION_ID:-}" in 22.04|24.04) ;; *) fail 'Ubuntu 22.04 or 24.04 is required.' ;; esac
for cmd in curl sha256sum tar mktemp; do command -v "$cmd" >/dev/null 2>&1 || fail "$cmd is required."; done
[ "$#" -eq 1 ] || fail 'Usage: sh install-shadow.sh /absolute/path/to/new-evaluation-directory'
DESTINATION=$1
case "$DESTINATION" in /*) ;; *) fail 'Choose an absolute destination path.' ;; esac
[ ! -e "$DESTINATION" ] && [ ! -L "$DESTINATION" ] || fail 'Destination already exists; choose a new directory.'
PARENT=$(dirname -- "$DESTINATION")
[ -d "$PARENT" ] || fail 'Create the parent directory first.'
TEMP_DIR=$(mktemp -d "$PARENT/.rlsok-shadow-download.XXXXXX")
trap 'rm -rf -- "$TEMP_DIR"' EXIT HUP INT TERM
curl -fL --proto '=https' --tlsv1.2 "$BASE/$ARCHIVE" -o "$TEMP_DIR/$ARCHIVE"
curl -fL --proto '=https' --tlsv1.2 "$BASE/$ARCHIVE.sha256" -o "$TEMP_DIR/$ARCHIVE.sha256"
(cd "$TEMP_DIR" && sha256sum -c "$ARCHIVE.sha256") || fail 'Archive checksum mismatch.'
mkdir "$TEMP_DIR/unpacked"
tar -xzf "$TEMP_DIR/$ARCHIVE" -C "$TEMP_DIR/unpacked"
# -T treats DESTINATION as the new directory, never as an existing container.
mv -T -n -- "$TEMP_DIR/unpacked/rlsok-shadow-evaluation-$RLSOK_SHADOW_VERSION" "$DESTINATION"
[ ! -d "$TEMP_DIR/unpacked/rlsok-shadow-evaluation-$RLSOK_SHADOW_VERSION" ] || fail 'Destination appeared during installation; nothing was replaced.'
printf 'Installed local Shadow evaluation: %s\n' "$DESTINATION"
printf 'Start here: %s/docs/fanuc-shadow-self-service.md\n' "$DESTINATION"
printf 'CLI: %s/bin/rlsok profile help\n' "$DESTINATION"
printf 'Humble, private interfaces and physical FANUC operation remain unvalidated.\n'
