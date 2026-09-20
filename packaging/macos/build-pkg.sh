#!/bin/bash
# Run on macOS after verifying and extracting the versioned Mac payload.
set -euo pipefail
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
[[ $(uname -s) == Darwin ]] || { echo 'Build the native installer on macOS.' >&2; exit 1; }
[[ $# == 1 && $1 == /* ]] || { echo 'Usage: ./build-pkg.sh /absolute/new-output-directory' >&2; exit 1; }
[[ ! -e $1 && ! -L $1 ]] || { echo 'Output already exists.' >&2; exit 1; }
VERSION=$(cat "$ROOT/VERSION")
PLATFORM=$(cat "$ROOT/PLATFORM")
[[ $VERSION == 1.5.4 && $PLATFORM =~ ^darwin-(x64|arm64)$ ]] || { echo 'Unexpected payload identity.' >&2; exit 1; }
ARCH=${PLATFORM#darwin-}
OUT=$1
mkdir "$OUT"
WORK=$(mktemp -d "${TMPDIR:-/tmp}/rlsok-macos-pkg.XXXXXX")
trap 'rm -rf -- "$WORK"' EXIT
APP="$WORK/payload/Applications/RLSOK Local Check $VERSION.app"
mkdir -p "$(dirname "$APP")"
cat > "$WORK/main.applescript" <<'APPLESCRIPT'
on run
  set appPath to POSIX path of (path to me)
  set bundlePath to appPath & "Contents/Resources/local-check/"
  set choice to button returned of (display dialog "Compare robot settings with a reviewed copy. Try an included example first: it shows a matching setup and a changed calibration. No robot or account is needed." with title "RLSOK Local Check" buttons {"Cancel", "Open guide", "Run example"} default button "Run example")
  if choice is "Open guide" then
    do shell script "/usr/bin/open -t " & quoted form of (bundlePath & "START-HERE.md")
  else
    try
      set destination to do shell script quoted form of (bundlePath & "bin/run-example")
      display dialog "Example complete. The baseline matches; the changed calibration is flagged. Your two reports are saved locally. No robot command was sent." with title "RLSOK Local Check" buttons {"Open reports"} default button "Open reports"
      do shell script "/usr/bin/open " & quoted form of destination
    on error messageText
      display dialog messageText with title "RLSOK could not run the example" buttons {"OK"} default button "OK" with icon caution
    end try
  end if
end run
APPLESCRIPT
/usr/bin/osacompile -o "$APP" "$WORK/main.applescript"
mkdir -p "$APP/Contents/Resources/local-check"
cp -R "$ROOT/." "$APP/Contents/Resources/local-check/"
rm "$APP/Contents/Resources/local-check/build-pkg.sh"
cat > "$APP/Contents/Resources/local-check/bin/run-example" <<'EXAMPLE'
#!/bin/bash
set -euo pipefail
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)
mkdir -p "$HOME/Documents/RLSOK"
WORK=$(mktemp -d "$HOME/Documents/RLSOK/Example-XXXXXX")
"$ROOT/bin/rlsok" profile demo --output "$WORK/reports" > "$WORK/example.log" 2>&1 || { cat "$WORK/example.log" >&2; exit 1; }
printf '%s\n' "$WORK/reports"
EXAMPLE
chmod 755 "$APP/Contents/Resources/local-check/bin/"*
set_plist() {
  /usr/libexec/PlistBuddy -c "Set :$1 $2" "$APP/Contents/Info.plist" 2>/dev/null ||
    /usr/libexec/PlistBuddy -c "Add :$1 string $2" "$APP/Contents/Info.plist"
}
set_plist CFBundleIdentifier com.rlsok.local-check
set_plist CFBundleShortVersionString "$VERSION"
set_plist CFBundleVersion "$VERSION"
set_plist LSMinimumSystemVersion 14.0
/usr/bin/pkgbuild --root "$WORK/payload" --identifier "com.rlsok.local-check.$ARCH" --version "$VERSION" --install-location / "$OUT/RLSOK-Local-Check-$VERSION-macos-$ARCH.pkg"
(cd "$OUT" && /usr/bin/shasum -a 256 ./*.pkg > SHA256SUMS)
printf 'Built native installer: %s\n' "$OUT"
