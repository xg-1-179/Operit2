#!/usr/bin/env python3
import hashlib
import json
import re
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
APP = ROOT / "apps" / "flutter" / "app"
VENDOR = ROOT / "tools" / "build_scripts" / "vendor"
metadata = json.loads((VENDOR / "dependency-source.json").read_text(encoding="utf-8"))
archive_path = VENDOR / f"flutter-packages-{metadata['commit']}.zip"
if hashlib.sha256(archive_path.read_bytes()).hexdigest() != metadata["sha256"]:
    raise RuntimeError("Pinned Flutter dependency archive checksum mismatch")
output = ROOT / ".ci-tools" / "flutter-packages"
with zipfile.ZipFile(archive_path) as archive:
    for entry in archive.infolist():
        destination = (output / entry.filename).resolve()
        if not destination.is_relative_to(output.resolve()):
            raise RuntimeError(f"Unsafe archive entry: {entry.filename}")
    archive.extractall(output)

pubspec_path = APP / "pubspec.yaml"
lock_path = APP / "pubspec.lock"
pubspec = pubspec_path.read_text(encoding="utf-8")
lock = lock_path.read_text(encoding="utf-8")
for name, path in metadata["packages"].items():
    local = f"../../../.ci-tools/flutter-packages/{path}"
    manifest = output / path / "pubspec.yaml"
    if not manifest.is_file():
        raise RuntimeError(f"Missing pinned dependency manifest: {manifest}")
    pattern = (
        rf"(?m)^  {re.escape(name)}:\n    git:\n"
        rf"      url: {re.escape(metadata['source'])}\n"
        rf"      ref: {metadata['commit']}\n"
        rf"      path: {re.escape(path)}\n"
    )
    pubspec, count = re.subn(pattern, f"  {name}:\n    path: {local}\n", pubspec)
    if count != 1:
        raise RuntimeError(f"Unexpected dependency declaration for {name}: {count}")
    lock_pattern = (
        rf'(?m)(^  {re.escape(name)}:\n    dependency: "direct main"\n)'
        rf'    description:\n      path: "{re.escape(path)}"\n'
        rf'      ref: "{metadata["commit"]}"\n'
        rf'      resolved-ref: "{metadata["commit"]}"\n'
        rf'      url: "{re.escape(metadata["source"])}"\n    source: git\n'
    )
    replacement = rf'\g<1>    description:\n      path: "{local}"\n      relative: true\n    source: path\n'
    lock, count = re.subn(lock_pattern, replacement, lock)
    if count != 1:
        raise RuntimeError(f"Unexpected locked dependency for {name}: {count}")
    print(f"Using pinned {name} from {metadata['commit']}")
pubspec_path.write_text(pubspec, encoding="utf-8", newline="\n")
lock_path.write_text(lock, encoding="utf-8", newline="\n")
