#!/usr/bin/env node
"use strict";

const { execFileSync } = require("node:child_process");
const {
  chmodSync,
  copyFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} = require("node:fs");
const { tmpdir } = require("node:os");
const { basename, dirname, join, resolve } = require("node:path");
const { createHash } = require("node:crypto");

if (process.platform !== "linux" || process.arch !== "x64") {
  throw new Error("linux_x64_bundle_must_be_built_on_linux_x64");
}

const root = resolve(__dirname, "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const version = pkg.version;
const archiveName = `rlsok-runtime-${version}-linux-x64.tar.gz`;
const artifacts = join(root, "artifacts");
const temporary = mkdtempSync(join(tmpdir(), "rlsok-linux-bundle-"));
const stage = join(temporary, `rlsok-runtime-${version}`);

function copy(source, target) {
  mkdirSync(dirname(target), { recursive: true });
  cpSync(source, target, { recursive: true });
}

try {
  execFileSync(process.execPath, [require.resolve("typescript/bin/tsc"), "-p", "tsconfig.build.json"], {
    cwd: root,
    stdio: "inherit",
  });
  mkdirSync(join(stage, "bin"), { recursive: true });
  copyFileSync(process.execPath, join(stage, "bin", "node"));
  chmodSync(join(stage, "bin", "node"), 0o755);
  copy(join(root, "dist"), join(stage, "lib", "rlsok", "dist"));
  copy(
    join(root, "experimental", "composable-shadow", "collect.py"),
    join(stage, "lib", "rlsok", "experimental", "composable-shadow", "collect.py"),
  );
  copy(
    join(root, "experimental", "composable-shadow", "sample_topic.py"),
    join(stage, "lib", "rlsok", "experimental", "composable-shadow", "sample_topic.py"),
  );
  copy(
    join(root, "docs", "composable-shadow.md"),
    join(stage, "COMPOSABLE_SHADOW.md"),
  );
  copy(
    join(root, "docs", "fanuc-humble-integration.md"),
    join(stage, "fanuc-humble-integration.md"),
  );
  copy(
    join(root, "experimental", "ros2-reference-sidecar"),
    join(stage, "lib", "rlsok", "experimental", "ros2-reference-sidecar"),
  );
  copy(
    join(root, "experimental", "husarion-rosbot-gazebo"),
    join(stage, "lib", "rlsok", "experimental", "husarion-rosbot-gazebo"),
  );
  copy(
    join(root, "sdk", "python", "rlsok"),
    join(stage, "lib", "rlsok", "sdk", "python", "rlsok"),
  );
  copy(
    join(root, "examples", "external-validation"),
    join(stage, "examples", "external-validation"),
  );
  copyFileSync(
    join(root, "docs", "EXTERNAL_ROS2_SHADOW_VALIDATION.md"),
    join(stage, "EXTERNAL_ROS2_SHADOW_VALIDATION.md"),
  );
  copyFileSync(
    join(root, "docs", "PHYSICAL_UR5E_VALIDATION.md"),
    join(stage, "PHYSICAL_UR5E_VALIDATION.md"),
  );
  copy(
    join(root, "examples", "husarion-rosbot-gazebo"),
    join(stage, "examples", "husarion-rosbot-gazebo"),
  );
  mkdirSync(join(stage, "scripts"), { recursive: true });
  for (const script of [
    "husarion-gazebo-acceptance.sh",
    "husarion-gazebo-monitor.py",
  ]) {
    copyFileSync(join(root, "scripts", script), join(stage, "scripts", script));
    chmodSync(join(stage, "scripts", script), 0o755);
  }
  for (const helper of [
    "capture-invocation.sh",
    "duplicate-replay-from-setup.sh",
    "generic_ros2_observer.py",
    "run_command_group.py",
    "run-isolated-case.sh",
    "run-recorded-command.sh",
    "setup-zero-to-shadow.sh",
    "shadow-once-from-setup.sh",
    "stale-state-from-setup.sh",
  ]) {
    chmodSync(join(stage, "examples", "external-validation", helper), 0o755);
  }
  const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"));
  for (const [location, metadata] of Object.entries(lock.packages)) {
    if (!location.startsWith("node_modules/") || metadata.dev === true) continue;
    const installed = JSON.parse(readFileSync(join(root, location, "package.json"), "utf8"));
    if (installed.version !== metadata.version) throw new Error(`installed_dependency_version_mismatch:${location}`);
    copy(
      join(root, location),
      join(stage, "lib", "rlsok", location),
    );
  }
  copyFileSync(join(root, "LICENSE"), join(stage, "LICENSE"));
  writeFileSync(join(stage, "VERSION"), `${version}\n`, "utf8");
  const launcher = `#!/bin/sh
set -eu
RLSOK_LAUNCHER=$(readlink -f -- "$0")
RLSOK_RUNTIME_ROOT=$(CDPATH= cd -- "$(dirname -- "$RLSOK_LAUNCHER")/.." && pwd)
exec "$RLSOK_RUNTIME_ROOT/bin/node" "$RLSOK_RUNTIME_ROOT/lib/rlsok/dist/apps/cli/rlsok.js" "$@"
`;
  writeFileSync(join(stage, "bin", "rlsok"), launcher, "utf8");
  chmodSync(join(stage, "bin", "rlsok"), 0o755);
  const versionOutput = execFileSync(join(stage, "bin", "rlsok"), ["--version"], {
    encoding: "utf8",
  }).trim();
  if (versionOutput !== `RLSOK ${version}`) {
    throw new Error(`bundle_version_mismatch:${versionOutput}`);
  }
  execFileSync(join(stage, "bin", "rlsok"), ["profile", "schema", "--output", join(temporary, "profile-schemas")]);
  const husarionSelfTest = execFileSync(
    "python3",
    [
      "-S",
      join(
        stage,
        "lib",
        "rlsok",
        "experimental",
        "husarion-rosbot-gazebo",
        "rlsok_husarion_rosbot_sidecar.py",
      ),
      "--self-test",
    ],
    { encoding: "utf8" },
  );
  if (!husarionSelfTest.includes("sidecar_self_test_passed")) {
    throw new Error("bundle_husarion_sidecar_self_test_failed");
  }
  const uninstall = `#!/bin/sh
set -eu
INSTALL_ROOT=\${RLSOK_INSTALL_ROOT:-/opt/rlsok}
BIN_DIR=\${RLSOK_BIN_DIR:-/usr/local/bin}
if [ "$(id -u)" -ne 0 ] && [ "$INSTALL_ROOT" = "/opt/rlsok" ]; then
  echo "Re-run with sudo: sudo $0" >&2
  exit 1
fi
rm -f "$BIN_DIR/rlsok"
if [ -f "$INSTALL_ROOT/.python-pth-path" ]; then
  PYTHON_PTH=$(cat "$INSTALL_ROOT/.python-pth-path")
  [ ! -f "$PYTHON_PTH" ] || rm -f "$PYTHON_PTH"
fi
rm -rf "$INSTALL_ROOT"
echo "RLSOK runtime removed. User configuration and Evidence were preserved under ~/.config/rlsok and ~/.local/share/rlsok."
`;
  writeFileSync(join(stage, "uninstall.sh"), uninstall, "utf8");
  chmodSync(join(stage, "uninstall.sh"), 0o755);
  mkdirSync(artifacts, { recursive: true });
  execFileSync("tar", ["-czf", join(artifacts, archiveName), "-C", temporary, basename(stage)]);
  const bytes = readFileSync(join(artifacts, archiveName));
  const digest = createHash("sha256").update(bytes).digest("hex");
  writeFileSync(join(artifacts, `${archiveName}.sha256`), `${digest}  ${archiveName}\n`, "utf8");
  process.stdout.write(
    `${JSON.stringify({ archive: archiveName, version, sizeBytes: bytes.length, sha256: digest })}\n`,
  );
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
