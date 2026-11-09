#!/usr/bin/env python3
"""Build the pinned Azwah Windows development target with Chromium's cross toolchain."""

import argparse
import json
import os
import platform
from pathlib import Path
import re
import shutil
import signal
import subprocess
import sys

ROOT = Path(__file__).resolve().parent.parent
GIB = 1024 ** 3


def run(args, cwd, env, reserve):
    print(f"{args[0]} {args[1]} ({shutil.disk_usage(cwd).free / GIB:.2f} GiB free)", flush=True)
    if shutil.disk_usage(cwd).free <= reserve:
        raise RuntimeError("The build workspace is below the configured free-space reserve.")
    process = subprocess.Popen(args, cwd=cwd, env=env, start_new_session=True)
    try:
        while True:
            try:
                code = process.wait(timeout=1)
            except subprocess.TimeoutExpired:
                if shutil.disk_usage(cwd).free <= reserve:
                    raise RuntimeError("Stopped the build to protect the filesystem free-space reserve.")
                continue
            if code:
                raise RuntimeError(f"{args[0]} {args[1]} exited with status {code}.")
            return
    finally:
        if process.poll() is None:
            try:
                os.killpg(process.pid, signal.SIGTERM)
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait()
            except ProcessLookupError:
                process.wait()


def git(path, *args):
    return subprocess.check_output(["git", "-C", str(path), *args])


def check_source(workspace, manifest, patch, reserve):
    """Fetch only the pinned paths needed to qualify the checked-in patch."""
    revision = manifest["revision"]
    workspace.mkdir(parents=True, exist_ok=True)
    marker = workspace / ".azwah-source-check"
    if marker.exists():
        if marker.read_text().strip() != revision:
            raise RuntimeError("Use a separate source-check workspace for a new revision.")
    else:
        if any(workspace.iterdir()):
            raise RuntimeError("Use an empty workspace for the first source check.")
        marker.write_text(revision + "\n")
    source = workspace / "src"
    source.mkdir(exist_ok=True)
    env = os.environ
    if not (source / ".git").exists():
        run(["git", "init", "--quiet"], source, env, reserve)
    git(source, "config", "remote.origin.url", manifest["repository"])
    git(source, "config", "remote.origin.promisor", "true")
    git(source, "config", "remote.origin.partialclonefilter", "tree:0")
    head = subprocess.run(["git", "rev-parse", "--verify", "HEAD"], cwd=source,
                          capture_output=True, check=False)
    if head.returncode:
        run(["git", "fetch", "--no-tags", "--depth=1", "--filter=tree:0", "origin", revision],
            source, env, reserve)
        paths = re.findall(r"^diff --git a/(\S+) b/\S+$", patch.read_text(), re.MULTILINE)
        paths += ["chrome/VERSION", "build/vs_toolchain.py", "docs/win_cross.md"]
        run(["git", "sparse-checkout", "set", "--no-cone", *["/" + path for path in paths]],
            source, env, reserve)
        run(["git", "checkout", "--detach", revision], source, env, reserve)
    if git(source, "rev-parse", "HEAD").decode().strip() != revision:
        raise RuntimeError("The source-check checkout does not match the requested revision.")
    run(["git", "apply", "--check", str(patch)], source, env, reserve)
    print("Patch applies to the pinned sparse checkout. Compilation was not requested.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", type=Path, required=True)
    parser.add_argument("--depot-tools", type=Path)
    parser.add_argument("--depot-tools-commit")
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--source-check-only", action="store_true")
    mode.add_argument("--sdk-archive", type=Path,
                        help="Local <toolchain hash>.zip created with Chromium's package_from_installed.py")
    parser.add_argument("--jobs", type=int, default=2)
    parser.add_argument("--reserve-gib", type=int, default=4)
    options = parser.parse_args()
    if platform.system() != "Linux" or platform.machine() != "x86_64":
        raise RuntimeError("This development build requires an x64 Linux host.")
    if options.jobs < 1 or options.reserve_gib < 2:
        parser.error("use at least one job and leave a reserve of at least 2 GiB")
    reserve = options.reserve_gib * GIB

    manifest = json.loads((ROOT / "native-chromium/upstream.json").read_text())
    revision = manifest["revision"]
    patch = ROOT / "native-chromium/windows-source.patch"
    if options.source_check_only:
        check_source(options.workspace.resolve(), manifest, patch, reserve)
        return
    if not options.depot_tools or not options.depot_tools_commit:
        parser.error("the build requires --depot-tools and --depot-tools-commit")
    tools = options.depot_tools.resolve(strict=True)
    if not re.fullmatch("[0-9a-f]{40}", options.depot_tools_commit):
        parser.error("the depot_tools pin must be a full Git commit SHA")
    if git(tools, "rev-parse", "HEAD").decode().strip() != options.depot_tools_commit or git(
        tools, "status", "--porcelain", "--untracked-files=no"
    ):
        raise RuntimeError("The depot_tools checkout must be clean and match the requested pin.")
    for name in ("gclient", "gn", "autoninja"):
        if not os.access(tools / name, os.X_OK):
            raise RuntimeError(f"The pinned depot_tools checkout is missing {name}.")

    sdk = options.sdk_archive.resolve()
    if not sdk.is_file() or not re.fullmatch("[0-9a-f]{10,64}\\.zip", sdk.name):
        raise RuntimeError("No Windows toolchain archive supplied. Use depot_tools/win_toolchain/"
                           "package_from_installed.py on the matching Windows SDK and Visual Studio installation.")
    # The key below is part of the pinned upstream build/vs_toolchain.py contract.
    toolchain_hash = manifest["windowsToolchainHash"]
    env = {
        **os.environ,
        "PATH": str(tools) + os.pathsep + os.environ["PATH"],
        "DEPOT_TOOLS_UPDATE": "0",
        "DEPOT_TOOLS_WIN_TOOLCHAIN": "1",
        "DEPOT_TOOLS_WIN_TOOLCHAIN_BASE_URL": str(sdk.parent),
        f"GYP_MSVS_HASH_{toolchain_hash}": sdk.stem,
    }

    workspace = options.workspace.resolve()
    workspace.mkdir(parents=True, exist_ok=True)
    source = workspace / "src"
    config = workspace / ".gclient"
    marker = workspace / ".azwah-cross-build"
    pins = f"{revision} {options.depot_tools_commit} {sdk.stem}\n"
    if marker.exists():
        if marker.read_text() != pins:
            raise RuntimeError("Use a separate workspace for different build pins.")
    else:
        if any(workspace.iterdir()):
            raise RuntimeError("Use a dedicated empty workspace for the first cross build.")
        marker.write_text(pins)
    if not config.exists():
        run([str(tools / "gclient"), "config", "--unmanaged", manifest["repository"]],
            workspace, env, reserve)
        with config.open("a") as file:
            file.write("\ntarget_os = ['win']\n")

    dirty = git(source, "-c", "core.quotePath=true", "diff", "--no-color", "--no-ext-diff",
                "--binary", "--full-index", "HEAD") if (source / ".git").exists() else b""
    if dirty and dirty != patch.read_bytes():
        raise RuntimeError("The Chromium checkout contains tracked changes outside the Azwah patch.")
    if not dirty:
        run([str(tools / "gclient"), "sync", "--no-history", "--revision", f"src@{revision}",
             "--jobs", str(options.jobs)], workspace, env, reserve)
    if git(source, "rev-parse", "HEAD").decode().strip() != revision:
        raise RuntimeError("The Chromium checkout does not match the patch pin.")
    if not dirty:
        run(["git", "apply", "--check", str(patch)], source, env, reserve)
        run(["git", "apply", str(patch)], source, env, reserve)

    output = source / "out/azwah-win-cross"
    output.mkdir(parents=True, exist_ok=True)
    (output / "args.gn").write_text(
        'target_os = "win"\ntarget_cpu = "x64"\nis_debug = false\n'
        'is_component_build = false\nis_chrome_branded = false\nsymbol_level = 0\n'
    )
    run([str(tools / "gn"), "gen", str(output)], source, env, reserve)
    run([str(tools / "autoninja"), "-C", str(output), "-j", str(options.jobs), "chrome"],
        source, env, reserve)
    browser = output / "chrome.exe"
    if not browser.is_file():
        raise RuntimeError("Chromium build completed without producing chrome.exe.")
    print(f"Development target compiled at {browser}. Windows execution and packaging require separate qualification.")


if __name__ == "__main__":
    try:
        main()
    except (OSError, RuntimeError, subprocess.CalledProcessError) as error:
        sys.exit(str(error))
