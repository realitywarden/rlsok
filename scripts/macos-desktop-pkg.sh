#!/bin/sh
set -eu
HERE="$(CDPATH= cd -- "${1:-$(dirname -- "$0")}" && pwd)"
if [ "$(uname -s)" != Darwin ]; then echo 'Build the native installer on macOS.' >&2; exit 1; fi
VERSION=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$HERE/RLSOK.app/Contents/Info.plist")
ARCH=$("$HERE/RLSOK.app/Contents/Resources/bin/node" -p 'process.arch')
OUTPUT="$HERE/rlsok-$VERSION-macos-$ARCH.pkg"
if [ -e "$OUTPUT" ]; then echo 'Installer already exists; keep its original bytes.' >&2; exit 1; fi
# An explicit payload root prevents Installer from relocating the application
# to an extracted build copy with the same bundle identifier.
STAGE=$(mktemp -d "${TMPDIR:-/tmp}/rlsok-pkg.XXXXXX")
trap 'rm -rf -- "$STAGE"' EXIT HUP INT TERM
mkdir "$STAGE/root"
cp -R "$HERE/RLSOK.app" "$STAGE/root/RLSOK.app"
pkgbuild --analyze --root "$STAGE/root" "$STAGE/components.plist"
python3 - "$STAGE/components.plist" <<'PY'
import plistlib,sys
path=sys.argv[1]
with open(path,'rb') as f: components=plistlib.load(f)
for component in components:
    component['BundleIsRelocatable']=False
with open(path,'wb') as f: plistlib.dump(components,f)
PY
# Signing is explicit; the build never labels an unsigned package as notarized.
if [ -n "${RLSOK_INSTALLER_SIGNING_IDENTITY:-}" ]; then
  pkgbuild --root "$STAGE/root" --component-plist "$STAGE/components.plist" --install-location /Applications --identifier com.rlsok.desktop --version "$VERSION" --sign "$RLSOK_INSTALLER_SIGNING_IDENTITY" "$OUTPUT"
else
  pkgbuild --root "$STAGE/root" --component-plist "$STAGE/components.plist" --install-location /Applications --identifier com.rlsok.desktop --version "$VERSION" "$OUTPUT"
fi
(cd "$HERE" && shasum -a 256 "$(basename "$OUTPUT")" > "$(basename "$OUTPUT").sha256")
