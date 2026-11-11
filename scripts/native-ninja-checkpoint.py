"""Checkpoint a trusted Ninja output tree without altering source timestamps."""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath, PureWindowsPath
import shutil
import stat
import zipfile

INDEX = "snapshot.json"
LIMIT = 3 * 1024**3
RAW_LIMIT = 12 * 1024**3
REQUIRED = {"build.ninja", "args.gn", ".ninja_log", ".ninja_deps"}


def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def save(root, bundle, identity):
    paths = sorted(root.rglob("*"))
    files = {}
    for path in paths:
        status = path.lstat()
        if path.is_symlink() or getattr(status, "st_file_attributes", 0) & 1024:
            raise ValueError(f"Reparse point in Ninja output: {path}")
        if stat.S_ISDIR(status.st_mode):
            continue
        if not stat.S_ISREG(status.st_mode):
            raise ValueError(f"Unsupported Ninja output: {path}")
        files[path.relative_to(root).as_posix()] = [status.st_size, status.st_mtime_ns]
    if not REQUIRED <= files.keys() or sum(entry[0] for entry in files.values()) > RAW_LIMIT:
        raise ValueError("Ninja output tree is incomplete or exceeds the raw size budget")
    temporary = bundle.with_suffix(".tmp")
    try:
        with zipfile.ZipFile(temporary, "x", zipfile.ZIP_DEFLATED, compresslevel=1) as archive:
            archive.writestr(INDEX, json.dumps({"identity": digest(identity), "files": files}))
            for name in files:
                path = root / name
                archive.write(path, f"out/{name}")
                status = path.stat()
                if [status.st_size, status.st_mtime_ns] != files[name]:
                    raise ValueError(f"Ninja output changed during checkpoint: {name}")
                if temporary.stat().st_size > LIMIT:
                    raise ValueError("Compressed checkpoint exceeds its 3 GiB budget")
        if temporary.stat().st_size > LIMIT:
            raise ValueError("Compressed checkpoint exceeds its 3 GiB budget")
        temporary.replace(bundle)
    finally:
        temporary.unlink(missing_ok=True)
    checksum = digest(bundle)
    bundle.with_suffix(".sha256").write_text(checksum + "\n", encoding="ascii")
    print(f"Saved Ninja checkpoint files={len(files)} bytes={bundle.stat().st_size} sha256={checksum}")


def restore(root, bundle, identity):
    if root.exists():
        raise ValueError("Ninja restore requires a fresh destination")
    if bundle.stat().st_size > LIMIT or digest(bundle) != bundle.with_suffix(".sha256").read_text().strip():
        raise ValueError("Ninja checkpoint integrity check failed")
    with zipfile.ZipFile(bundle) as archive:
        entries = archive.infolist()
        if sum(entry.file_size for entry in entries) > RAW_LIMIT:
            raise ValueError("Ninja checkpoint exceeds the raw size budget")
        manifest = json.loads(archive.read(INDEX))
        files = manifest["files"]
        if manifest["identity"] != digest(identity) or not REQUIRED <= files.keys():
            raise ValueError("Ninja checkpoint build identity does not match")
        expected = {INDEX, *(f"out/{name}" for name in files)}
        if len(entries) != len(expected) or {entry.filename for entry in entries} != expected:
            raise ValueError("Unexpected or duplicate archive entries")
        normalized = set()
        for name, (size, timestamp) in files.items():
            parts = PurePosixPath(name).parts
            if (not parts or name != "/".join(parts) or any(
                part in {".", ".."} or PureWindowsPath(part).is_reserved() or any(char in part for char in "\\\\:") or part.endswith((" ", "."))
                for part in parts
            ) or name.casefold() in normalized or archive.getinfo(f"out/{name}").file_size != size
                or not isinstance(timestamp, int) or timestamp < 0):
                raise ValueError(f"Invalid archive entry: {name}")
            normalized.add(name.casefold())
        root.mkdir(parents=True)
        try:
            for name, (_, timestamp) in files.items():
                output = root / name
                output.parent.mkdir(parents=True, exist_ok=True)
                with archive.open(f"out/{name}") as source, output.open("xb") as target:
                    shutil.copyfileobj(source, target)
                os.utime(output, ns=(timestamp, timestamp))
        except BaseException:
            shutil.rmtree(root)
            raise
    print(f"Restored Ninja checkpoint files={len(files)} bytes={bundle.stat().st_size}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("operation", choices=("save", "restore"))
    parser.add_argument("output", type=Path)
    parser.add_argument("archive", type=Path)
    parser.add_argument("identity", type=Path)
    args = parser.parse_args()
    (save if args.operation == "save" else restore)(args.output, args.archive, args.identity)
