#!/usr/bin/env python3
"""Package the pinned Chromium Windows toolchain for private use on a cross-build host."""

import argparse
import hashlib
import json
import platform
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parent.parent


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--depot-tools", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True,
                        help="Dedicated empty private directory for the generated archive")
    options = parser.parse_args()
    if platform.system() != "Windows" or platform.machine().upper() not in {"AMD64", "X86_64"}:
        parser.error("use a Windows x64 machine with the matching Visual Studio and SDK installed")

    manifest = json.loads((ROOT / "native-chromium/upstream.json").read_text())
    packer = options.depot_tools.resolve() / "win_toolchain/package_from_installed.py"
    if not packer.is_file():
        parser.error("could not find Chromium's package_from_installed.py in --depot-tools")
    output = options.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    if any(output.iterdir()):
        parser.error("use an empty output directory to protect existing archives")

    subprocess.run([sys.executable, str(packer), manifest["visualStudioVersion"], "-w",
                    manifest["windowsSdkVersion"], "--noarm"], cwd=output, check=True)
    archives = [file for file in output.iterdir() if re.fullmatch(r"[0-9a-f]{10}\.zip", file.name)]
    if len(archives) != 1 or not archives[0].is_file():
        raise RuntimeError("The upstream packer did not produce exactly one hash-named archive.")
    with archives[0].open("rb") as stream:
        digest = hashlib.file_digest(stream, "sha256").hexdigest()
    print(f"{digest}  {archives[0]}")
    print("Transfer this toolchain privately to an authorized build host.")


if __name__ == "__main__":
    try:
        main()
    except (OSError, RuntimeError, subprocess.CalledProcessError) as error:
        sys.exit(str(error))
