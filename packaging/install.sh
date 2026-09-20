#!/bin/sh
set -eu

RLSOK_PRODUCT_VERSION="1.3.0"
RLSOK_RUNTIME_VERSION="1.5.5"
RLSOK_RELEASE_TAG="v1.5.5"
ARCHIVE="rlsok-runtime-${RLSOK_RUNTIME_VERSION}-linux-x64.tar.gz"
RELEASE_BASE="${RLSOK_RELEASE_BASE:-https://github.com/realitywarden/rlsok/releases/download/${RLSOK_RELEASE_TAG}}"
INSTALL_ROOT="${RLSOK_INSTALL_ROOT:-/opt/rlsok}"
BIN_DIR="${RLSOK_BIN_DIR:-/usr/local/bin}"

fail() {
  echo "RLSOK install: $1" >&2
  exit 1
}

[ "$(uname -s)" = "Linux" ] || fail "Ubuntu 24.04 x86_64 is required."
[ "$(uname -m)" = "x86_64" ] || fail "x86_64 is required; ARM64 is not supported by this release."
if [ -r /etc/os-release ]; then
  # shellcheck disable=SC1091
  . /etc/os-release
  [ "${ID:-}" = "ubuntu" ] && [ "${VERSION_ID:-}" = "24.04" ] ||
    fail "Ubuntu 24.04 is required; found ${PRETTY_NAME:-an unsupported Linux release}."
fi
command -v curl >/dev/null 2>&1 || fail "curl is required. Install it with: sudo apt-get install curl"
command -v sha256sum >/dev/null 2>&1 || fail "sha256sum is required (package: coreutils)."
command -v tar >/dev/null 2>&1 || fail "tar is required."
command -v python3 >/dev/null 2>&1 || fail "python3 is required (ROS 2 Jazzy uses it for the policy proposal SDK)."

if [ "$(id -u)" -ne 0 ] && [ "$INSTALL_ROOT" = "/opt/rlsok" ]; then
  fail "system installation needs root. Use: curl -fsSL https://rlsok.com/install.sh | sudo sh"
fi

TEMP_DIR=$(mktemp -d)
trap 'rm -rf "$TEMP_DIR"' EXIT HUP INT TERM
if [ -n "${RLSOK_RELEASE_DIR:-}" ]; then
  cp "$RLSOK_RELEASE_DIR/$ARCHIVE" "$TEMP_DIR/$ARCHIVE"
  cp "$RLSOK_RELEASE_DIR/$ARCHIVE.sha256" "$TEMP_DIR/$ARCHIVE.sha256"
else
  curl -fL --proto '=https' --tlsv1.2 "$RELEASE_BASE/$ARCHIVE" -o "$TEMP_DIR/$ARCHIVE"
  curl -fL --proto '=https' --tlsv1.2 "$RELEASE_BASE/$ARCHIVE.sha256" -o "$TEMP_DIR/$ARCHIVE.sha256"
fi
(cd "$TEMP_DIR" && sha256sum -c "$ARCHIVE.sha256") || fail "download checksum verification failed."
tar -xzf "$TEMP_DIR/$ARCHIVE" -C "$TEMP_DIR"

VERSION_ROOT="$INSTALL_ROOT/$RLSOK_RUNTIME_VERSION"
ROLLBACK_ROOT="$INSTALL_ROOT/$RLSOK_RUNTIME_VERSION.rollback"
if [ -n "${RLSOK_PYTHON_SITE:-}" ]; then
  PYTHON_SITE="$RLSOK_PYTHON_SITE"
elif [ "$INSTALL_ROOT" = "/opt/rlsok" ]; then
  PYTHON_SITE=$(python3 -c 'import site; print(site.getsitepackages()[0])')
else
  PYTHON_SITE="$INSTALL_ROOT/python-site"
fi
PYTHON_PTH="$PYTHON_SITE/rlsok.pth"
PYTHON_PTH_PATH="$INSTALL_ROOT/.python-pth-path"
CLI_LINK="$BIN_DIR/rlsok"
UNINSTALL_LINK="$INSTALL_ROOT/uninstall.sh"
BACKUP_ROOT="$INSTALL_ROOT/$RLSOK_RUNTIME_VERSION.activation-backup"
mkdir -p "$INSTALL_ROOT" "$BIN_DIR"
[ ! -e "$ROLLBACK_ROOT" ] ||
  fail "an unfinished rollback exists at $ROLLBACK_ROOT. Do not retry or remove it; restore the previous runtime and registrations from the retained recovery paths."
[ ! -e "$BACKUP_ROOT" ] ||
  fail "unfinished activation recovery exists at $BACKUP_ROOT. Do not retry or remove it; restore the previous runtime and registrations from the retained recovery paths."
mkdir -p "$BACKUP_ROOT"
rm -rf "$VERSION_ROOT.new"
mv "$TEMP_DIR/rlsok-runtime-$RLSOK_RUNTIME_VERSION" "$VERSION_ROOT.new"

snapshot_path() {
  SNAPSHOT_NAME=$1
  SNAPSHOT_PATH=$2
  if [ -L "$SNAPSHOT_PATH" ]; then
    printf 'symlink\n' > "$BACKUP_ROOT/$SNAPSHOT_NAME.kind"
    readlink "$SNAPSHOT_PATH" > "$BACKUP_ROOT/$SNAPSHOT_NAME.target"
  elif [ -e "$SNAPSHOT_PATH" ]; then
    printf 'file\n' > "$BACKUP_ROOT/$SNAPSHOT_NAME.kind"
    cp -p "$SNAPSHOT_PATH" "$BACKUP_ROOT/$SNAPSHOT_NAME.file"
  else
    printf 'absent\n' > "$BACKUP_ROOT/$SNAPSHOT_NAME.kind"
  fi
}

restore_path() {
  SNAPSHOT_NAME=$1
  SNAPSHOT_PATH=$2
  rm -f "$SNAPSHOT_PATH"
  case "$(cat "$BACKUP_ROOT/$SNAPSHOT_NAME.kind")" in
    symlink)
      ln -s "$(cat "$BACKUP_ROOT/$SNAPSHOT_NAME.target")" "$SNAPSHOT_PATH"
      ;;
    file)
      cp -p "$BACKUP_ROOT/$SNAPSHOT_NAME.file" "$SNAPSHOT_PATH"
      ;;
    absent) ;;
  esac
}

snapshot_path cli-link "$CLI_LINK"
snapshot_path uninstall-link "$UNINSTALL_LINK"
snapshot_path python-pth "$PYTHON_PTH"
snapshot_path python-pth-path "$PYTHON_PTH_PATH"
PYTHON_SITE_EXISTED=false
[ -d "$PYTHON_SITE" ] && PYTHON_SITE_EXISTED=true
HAD_PREVIOUS=false

injected_failure() {
  [ "${RLSOK_INSTALL_FAIL_AT:-}" = "$1" ]
}

activate_install() {
  if [ -e "$VERSION_ROOT" ]; then
    mv "$VERSION_ROOT" "$ROLLBACK_ROOT" || return 1
    HAD_PREVIOUS=true
  fi
  mv "$VERSION_ROOT.new" "$VERSION_ROOT" || return 1
  if injected_failure directory-activation; then return 1; fi

  ln -sfn "$VERSION_ROOT/bin/rlsok" "$CLI_LINK" || return 1
  if injected_failure cli-link; then return 1; fi
  ln -sfn "$VERSION_ROOT/uninstall.sh" "$UNINSTALL_LINK" || return 1
  if injected_failure uninstall-link; then return 1; fi

  mkdir -p "$PYTHON_SITE" || return 1
  if injected_failure python-site; then return 1; fi
  printf '%s\n' "$VERSION_ROOT/lib/rlsok/sdk/python" > "$PYTHON_PTH" || return 1
  if injected_failure python-registration; then return 1; fi
  printf '%s\n' "$PYTHON_PTH" > "$PYTHON_PTH_PATH" || return 1

  if injected_failure cli-verification; then return 1; fi
  "$CLI_LINK" --version || return 1
  if injected_failure python-verification; then return 1; fi
  RLSOK_VERIFY_PYTHON_SITE="$PYTHON_SITE" python3 -c 'import os, site; site.addsitedir(os.environ["RLSOK_VERIFY_PYTHON_SITE"]); from rlsok import propose; assert callable(propose)' || return 1
  return 0
}

rollback_install() {
  restore_path python-pth-path "$PYTHON_PTH_PATH" || return 1
  restore_path python-pth "$PYTHON_PTH" || return 1
  if [ "$PYTHON_SITE_EXISTED" = false ]; then
    rmdir "$PYTHON_SITE" 2>/dev/null || true
  fi
  restore_path uninstall-link "$UNINSTALL_LINK" || return 1
  restore_path cli-link "$CLI_LINK" || return 1
  rm -rf "$VERSION_ROOT" "$VERSION_ROOT.new"
  if [ "$HAD_PREVIOUS" = true ]; then
    mv "$ROLLBACK_ROOT" "$VERSION_ROOT" || return 1
  fi
  rm -rf "$ROLLBACK_ROOT"
  rm -rf "$BACKUP_ROOT"
}

if ! activate_install; then
  if rollback_install; then
    fail "activation or finalization failed; the previous runtime and registrations were restored."
  fi
  fail "activation or finalization failed and rollback was incomplete; recovery remains at $ROLLBACK_ROOT and $BACKUP_ROOT."
fi

rm -rf "$ROLLBACK_ROOT" "$BACKUP_ROOT"

echo "RLSOK runtime $RLSOK_RUNTIME_VERSION (product v$RLSOK_PRODUCT_VERSION) installed at $VERSION_ROOT"
echo "Python proposal SDK installed for: $PYTHON_SITE"
echo "Next: source /opt/ros/jazzy/setup.bash && rlsok setup"
