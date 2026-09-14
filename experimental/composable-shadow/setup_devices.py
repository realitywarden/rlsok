#!/usr/bin/env python3
"""Enumerate Linux device identity metadata without opening any /dev node.

Reads sysfs attributes and udev's database only. Does not use v4l2-ctl,
SocketCAN, pyserial, OpenCV or a robot SDK. It cannot identify an RGB stream,
prove a USB adapter is attached to the intended arm, or discover missing unit
serials. The operator must select and review roles and endpoint subchannels.
"""
import argparse
import datetime
import json
import os
from pathlib import Path
import platform
import re
import subprocess
import sys


def attribute(path):
    try:
        # sysfs metadata only; never a path supplied by a config or /dev node.
        with path.open(encoding="utf-8") as stream:
            return stream.read(4096).strip()
    except OSError:
        return ""


def collect():
    if platform.system() != "Linux":
        raise ValueError("Linux sysfs is required; on another OS supply an operator-export inventory.")
    devices, warnings = [], []
    for kind, directory in (("camera", "/sys/class/video4linux"),
                            ("can", "/sys/class/net"), ("serial", "/sys/class/tty")):
        root = Path(directory)
        if not root.exists():
            continue
        for entry in sorted(root.iterdir()):
            if kind == "can" and attribute(entry / "type") != "280":
                continue
            if kind == "serial" and not re.fullmatch(r"tty(?:USB|ACM)\d+", entry.name):
                continue
            if kind == "camera" and not re.fullmatch(r"video\d+", entry.name):
                continue
            if len(devices) >= 500:
                raise ValueError("More than 500 endpoints; narrow the saved inventory manually.")
            result = subprocess.run(
                ["udevadm", "info", "--query=property", "--path=" + str(entry)],
                check=False, capture_output=True, text=True, timeout=3,
            )
            props = dict(line.split("=", 1) for line in result.stdout.splitlines() if "=" in line)
            if result.returncode:
                warnings.append(entry.name + ": udev metadata unavailable")
            locator = entry.name if kind == "can" else "/dev/" + entry.name
            item = {"kind": kind, "locator": locator, "aliases": []}
            if kind == "camera":
                item["aliases"].append(entry.name[5:])
            for key, prop in (("serial", "ID_SERIAL_SHORT"), ("usbPath", "ID_PATH"),
                              ("interface", "ID_USB_INTERFACE_NUM")):
                if props.get(prop):
                    item[key] = props[prop]
            # A serial may live on the USB parent rather than the endpoint.
            # Do not manufacture one from ID_SERIAL (which may be model-only).
            for parent in [entry.resolve(), *entry.resolve().parents]:
                if str(parent) == "/sys":
                    break
                if not str(parent).startswith("/sys/"):
                    raise ValueError("sysfs endpoint resolved outside /sys")
                if "interface" not in item and (parent / "bInterfaceNumber").exists():
                    item["interface"] = attribute(parent / "bInterfaceNumber")
                if "serial" not in item and (parent / "idVendor").exists():
                    serial = attribute(parent / "serial")
                    if serial:
                        item["serial"] = serial
            if kind == "camera":
                index = attribute(entry / "index")
                if index:
                    item["videoIndex"] = index
            if kind == "can":
                port = attribute(entry / "dev_port")
                if port:
                    item["interface"] = item.get("interface", "") + ":port=" + port
            if kind != "can":
                for folder in ("/dev/v4l/by-id", "/dev/v4l/by-path", "/dev/serial/by-id", "/dev/serial/by-path"):
                    path = Path(folder)
                    if path.is_dir():
                        for link in path.iterdir():
                            if link.is_symlink() and str(link.resolve()) == locator:
                                item["aliases"].append(str(link))
            if "serial" not in item:
                warnings.append(entry.name + ": no unique serial reported; a reviewed USB topology binding identifies a port, not a unit")
            item["aliases"] = sorted(set(item["aliases"]))
            devices.append(item)
    return {"schemaVersion": 1, "observedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "method": "linux-sysfs-udev", "devices": devices, "warnings": warnings}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    output = Path(args.output)
    if output.exists():
        raise ValueError("Output already exists; use a new inventory filename.")
    data = collect()
    fd = os.open(output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as stream:
        json.dump(data, stream, indent=2)
        stream.write("\n")
    print(f"Saved {len(data['devices'])} metadata entries. No device nodes opened.")


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, subprocess.SubprocessError) as exc:
        print(f"Device inventory not completed: {exc}", file=sys.stderr)
        sys.exit(2)
