#!/usr/bin/env python3
"""Copy an extracted Ollama archive into the bundle tree.

The caller verifies the archive checksum before extraction. Directories
whose names start with cuda_ are not copied. In the pinned v0.40.11
amd64 archives those CUDA runners are about 2.3 GB uncompressed. NSIS
compression is off, and a GitHub release asset has to stay under 2 GiB.
CPU runners, Vulkan, and the macOS Metal runners stay. This script does
not download a model and does not run ollama.
"""

import hashlib
import json
import os
import shutil
import re
import sys


def find_binary(root):
    matches = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [name for name in dirnames if name != "__MACOSX" and not name.startswith("._")]
        for name in filenames:
            if name in ("ollama", "ollama.exe") and not name.startswith("._"):
                matches.append(os.path.join(dirpath, name))
    if not matches:
        raise SystemExit("ollama binary missing in archive")

    def rank(path):
        parent = os.path.basename(os.path.dirname(path))
        score = 0
        if parent == "bin":
            score += 100
        if os.path.basename(path) == "ollama.exe":
            score += 10
        score -= path.count(os.sep)
        return score

    matches.sort(key=rank, reverse=True)
    return matches[0]


def tree_root(binary):
    parent = os.path.dirname(binary)
    if os.path.basename(parent) == "bin":
        return os.path.dirname(parent)
    return parent


def write_notice_inventory(root):
    """Bind all original runtime notices, including incorporated native code."""
    required = {
        "GO_LICENSE", "LLAMA_CPP_LICENSE", "LLAMA_CPP_VENDORS_LICENSE",
        "CPP_HTTPLIB_LICENSE", "FMT_LICENSE", "PICOJSON_LICENSE",
    }
    names = set()
    notices = []
    inspected = 0
    total = 0
    pattern = re.compile(r"(?:^|[._-])(?:licen[cs]es?|notices?|copying|copyright)(?:[._-]|$)", re.I)
    for directory, directories, files in os.walk(root):
        directories.sort()
        for name in sorted(files):
            inspected += 1
            if inspected > 100000:
                raise SystemExit("Ollama runtime notice traversal exceeded 100000 files")
            if name == "RUNTIME_NOTICES.json":
                continue
            names.add(name)
            if not pattern.search(name):
                continue
            path = os.path.join(directory, name)
            if os.path.commonpath([os.path.realpath(root), os.path.realpath(path)]) != os.path.realpath(root):
                raise SystemExit("Ollama notice symlink escapes staged runtime: " + name)
            size = os.path.getsize(path)
            total += size
            if size <= 0 or size > 4 * 1024 * 1024 or total > 16 * 1024 * 1024:
                raise SystemExit("empty or oversized original Ollama notice: " + name)
            with open(path, "rb") as source:
                digest = hashlib.sha256(source.read()).hexdigest()
            notices.append({"path": os.path.relpath(path, root).replace(os.sep, "/"), "sha256": digest, "bytes": size})
    if any("mlx" in name.lower() and not pattern.search(name) for name in names):
        required.update({"MLX_LICENSE", "MLX_C_LICENSE", "DLPACK_LICENSE"})
    if any("xgrammar" in name.lower() and not pattern.search(name) for name in names):
        required.update({"XGRAMMAR_LICENSE", "XGRAMMAR_NOTICE"})
    present = {notice["path"] for notice in notices}
    missing = sorted(required - present)
    if missing:
        raise SystemExit("Ollama incorporated-code full notices missing: " + ", ".join(missing))
    inventory = {
        "format": 1,
        "scope": "Original full notice files copied with the actual Ollama runtime; archive/source provenance remains separate, not inferred from SPDX.",
        "required": sorted(required),
        "files": sorted(notices, key=lambda entry: entry["path"]),
    }
    with open(os.path.join(root, "RUNTIME_NOTICES.json"), "w", encoding="utf-8", newline="\n") as destination:
        json.dump(inventory, destination, ensure_ascii=False, indent=2)
        destination.write("\n")
    print("notice_files=" + str(len(notices)))


def main():
    if len(sys.argv) != 4:
        raise SystemExit("usage: stage.py EXTRACTED_ROOT DEST ORIGINAL_OLLAMA_LICENSE")
    src = os.path.abspath(sys.argv[1])
    dest = os.path.abspath(sys.argv[2])
    license_source = os.path.abspath(sys.argv[3])
    if not os.path.isfile(license_source) or os.path.getsize(license_source) == 0:
        raise SystemExit("original full Ollama license missing")
    binary = find_binary(src)
    root = tree_root(binary)
    omitted = []

    def ignore(directory, names):
        skip = []
        for name in names:
            if name.startswith("._") or name == "__MACOSX" or name.startswith("cuda_"):
                skip.append(name)
                if name.startswith("cuda_"):
                    omitted.append(name)
        return skip

    if os.path.exists(dest):
        shutil.rmtree(dest)
    shutil.copytree(root, dest, symlinks=True, ignore=ignore)
    staged = find_binary(dest)
    if os.path.isfile(staged):
        mode = os.stat(staged).st_mode
        os.chmod(staged, mode | 0o755)
    for dirpath, dirnames, _filenames in os.walk(dest):
        for name in dirnames:
            if name.startswith("cuda_"):
                raise SystemExit("cuda runner was copied: " + name)
    shutil.copyfile(license_source, os.path.join(dest, "OLLAMA_LICENSE.txt"))
    write_notice_inventory(dest)
    names = sorted(set(omitted))
    if names:
        print("omitted=" + ",".join(names))
    else:
        print("omitted=none")
    print("binary=" + staged)


if __name__ == "__main__":
    main()
