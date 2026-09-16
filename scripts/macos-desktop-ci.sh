#!/bin/bash
set -euo pipefail
test "$(uname -s)" = Darwin
test "${GITHUB_REPOSITORY:?}" = realitywarden/rlsok
case "${MAC_ARCH:?}" in x64|arm64) ;; *) exit 2 ;; esac

bundle="$RUNNER_TEMP/rlsok-candidate/rlsok-1.3.2-macos-$MAC_ARCH"
app=/Applications/RLSOK.app
resources="$app/Contents/Resources"
state="$HOME/Library/Application Support/RLSOK"
evidence="$RUNNER_TEMP/rlsok-evidence-$MAC_ARCH"
mkdir -p "$evidence"
export RLSOK_CI_EVIDENCE="$evidence"

collect() {
  result=$?
  trap - EXIT
  printf '%s\n' "$result" > "$evidence/exit-code.txt"
  python3 - "$state" "$evidence" <<'PY'
import json,re,sys
from pathlib import Path
state,out=map(Path,sys.argv[1:])
secrets=[]
try:
    config=json.loads((state/'desktop.json').read_text())
    secrets=[config.get(k,'') for k in ('adminPassword','databasePassword','localAccessToken')]
except (OSError,ValueError): pass
for p in [*(state.glob('installer-verification-*.json')), *(state / n for n in ('startup.log','api.log','web.log','postgresql.log'))]:
    if not p.is_file(): continue
    text=p.read_text(errors='replace')[-1000000:]
    for secret in secrets:
        if secret: text=text.replace(secret,'[REDACTED]')
    text=re.sub(r'rlsok_session_[A-Za-z0-9_-]+','[REDACTED_SESSION]',text)
    (out/p.name).write_text(text)
PY
  if [ -x "$resources/bin/node" ]; then
    "$resources/bin/node" "$resources/desktop.mjs" stop >/dev/null 2>&1 || true
  fi
  exit "$result"
}
trap collect EXIT

test ! -e "$app"
test ! -e "$state"
test "$("$bundle/RLSOK.app/Contents/Resources/bin/node" -p 'process.arch')" = "$MAC_ARCH"
sw_vers > "$evidence/macos.txt"
uname -m >> "$evidence/macos.txt"
printf '%s\n' "$GITHUB_SHA" > "$evidence/workflow-source.txt"
printf '%s\n' "$CANDIDATE_SHA256" > "$evidence/input-archive-sha256.txt"

# Apply the exact source from this checkout to the checksummed base distribution.
# Record the base separately; the native installer is bound to this source SHA.
cp "$GITHUB_WORKSPACE/scripts/macos-desktop-launcher.mjs" "$bundle/RLSOK.app/Contents/Resources/desktop.mjs"
cp "$GITHUB_WORKSPACE/scripts/macos-desktop-web-launcher.mjs" "$bundle/RLSOK.app/Contents/Resources/web-launcher.mjs"
python3 - "$bundle/RLSOK.app/Contents/Resources/BUILD-MANIFEST.json" "$GITHUB_SHA" <<'PY'
import json,sys
path,source=sys.argv[1:]
with open(path) as f: manifest=json.load(f)
manifest['basePackagingSourceCommit']=manifest['packagingSourceCommit']
manifest['packagingSourceCommit']=source
manifest['packagingRepository']='realitywarden/rlsok'
manifest['nativeInstallerSources']=['scripts/macos-desktop-pkg.sh','scripts/macos-desktop-launcher.mjs','scripts/macos-desktop-web-launcher.mjs']
with open(path,'w') as f: json.dump(manifest,f,indent=2); f.write('\n')
PY

bash "$GITHUB_WORKSPACE/scripts/macos-desktop-pkg.sh" "$bundle" 2>&1 | tee "$evidence/pkgbuild.log"
package="$bundle/rlsok-1.3.2-macos-$MAC_ARCH.pkg"
(cd "$bundle" && shasum -a 256 "$(basename "$package")" > "$(basename "$package").sha256")
sudo installer -pkg "$package" -target / 2>&1 | tee "$evidence/installer.log"
pkgutil --pkg-info com.rlsok.desktop > "$evidence/receipt.txt"
pkgutil --files com.rlsok.desktop | head -n 25 > "$evidence/installed-paths.txt" || true
ls -ld "$app" "$app/Contents" "$app/Contents/Info.plist" > "$evidence/app-location.txt" 2>&1 || true
grep -q '^version: 1.3.2$' "$evidence/receipt.txt"
test "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$app/Contents/Info.plist")" = 1.3.2

# Exercise Launch Services as well as the bundled bootstrap and native modules.
open "$app"
for attempt in $(seq 1 120); do
  if curl -fsS --max-time 2 http://localhost:3000/local-start > /dev/null; then break; fi
  sleep 1
done
"$resources/bin/node" "$GITHUB_WORKSPACE/scripts/verify-macos-local-workspace.mjs" --verify-disposable-macos "$resources"
"$resources/bin/node" "$GITHUB_WORKSPACE/scripts/macos-desktop-ci.mjs" browser "$resources"

"$resources/bin/node" "$resources/desktop.mjs" stop
sudo installer -pkg "$package" -target / 2>&1 | tee "$evidence/reinstall.log"
"$resources/bin/node" "$resources/desktop.mjs" start
"$resources/bin/node" "$GITHUB_WORKSPACE/scripts/macos-desktop-ci.mjs" preserved "$resources"

# macOS uninstall means removing this app; user data remains available for reinstall.
"$resources/bin/node" "$resources/desktop.mjs" stop
test "$("$resources/bin/node" "$resources/desktop.mjs" status)" = '{"api":false,"web":false,"database":false}'
test "$app" = /Applications/RLSOK.app
sudo mv "$app" "$RUNNER_TEMP/RLSOK.removed.app"
test ! -e "$app"
test -f "$state/desktop.json"
sudo pkgutil --forget com.rlsok.desktop > "$evidence/removal.txt"
for port in 3000 8080; do
  if lsof -nP -iTCP:"$port" -sTCP:LISTEN > /dev/null; then echo "Port $port still in use" >&2; exit 1; fi
done
printf '%s\n' 'PASS: native package install, app launch, full local access, own files, restart, reinstall and removal. Signing and notarization remain separate.' > "$evidence/lifecycle.txt"
cp "$package.sha256" "$evidence/"
