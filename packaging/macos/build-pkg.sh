#!/bin/bash
# Run on macOS after verifying and extracting the versioned Mac payload.
set -euo pipefail
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
[[ $(uname -s) == Darwin ]] || { echo 'Build the native installer on macOS.' >&2; exit 1; }
[[ $# == 1 && $1 == /* ]] || { echo 'Usage: ./build-pkg.sh /absolute/new-output-directory' >&2; exit 1; }
[[ ! -e $1 && ! -L $1 ]] || { echo 'Output already exists.' >&2; exit 1; }
VERSION=$(cat "$ROOT/VERSION")
PLATFORM=$(cat "$ROOT/PLATFORM")
[[ $VERSION == 1.5.7 && $PLATFORM =~ ^darwin-(x64|arm64)$ ]] || { echo 'Unexpected payload identity.' >&2; exit 1; }
ARCH=${PLATFORM#darwin-}
OUT=$1
mkdir "$OUT"
WORK=$(mktemp -d "${TMPDIR:-/tmp}/rlsok-macos-pkg.XXXXXX")
trap 'rm -rf -- "$WORK"' EXIT
APP="$WORK/payload/Applications/RLSOK Local Check $VERSION.app"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
/usr/bin/xcrun swiftc -swift-version 5 -parse-as-library -O \
  -framework SwiftUI -framework AppKit \
  "$ROOT/RLSOKLocalCheck.swift" \
  -o "$APP/Contents/MacOS/RLSOKLocalCheck"
mkdir -p "$APP/Contents/Resources/local-check"
cp -R "$ROOT/." "$APP/Contents/Resources/local-check/"
rm "$APP/Contents/Resources/local-check/build-pkg.sh" \
  "$APP/Contents/Resources/local-check/RLSOKLocalCheck.swift"
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
cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleDisplayName</key><string>RLSOK Local Check $VERSION</string>
  <key>CFBundleExecutable</key><string>RLSOKLocalCheck</string>
  <key>CFBundleIdentifier</key><string>com.rlsok.local-check</string>
  <key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
  <key>CFBundleName</key><string>RLSOK Local Check</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>$VERSION</string>
  <key>CFBundleVersion</key><string>$VERSION</string>
  <key>LSMinimumSystemVersion</key><string>14.0</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSPrincipalClass</key><string>NSApplication</string>
</dict></plist>
PLIST
/usr/bin/plutil -lint "$APP/Contents/Info.plist"
/usr/bin/pkgbuild --root "$WORK/payload" --identifier "com.rlsok.local-check.$ARCH" --version "$VERSION" --install-location / "$OUT/RLSOK-Local-Check-$VERSION-macos-$ARCH.pkg"
(cd "$OUT" && /usr/bin/shasum -a 256 ./*.pkg > SHA256SUMS)
printf 'Built native installer: %s\n' "$OUT"
