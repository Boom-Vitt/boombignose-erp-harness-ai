#!/usr/bin/env python3
"""Fill the download pages from the latest published BoomBigNose release.

The browser never calls GitHub. This script runs in CI before GitHub Pages
uploads site/, and it can be run locally. It reads the newest release whose
tag matches boombignose-vX.Y.Z, is not a draft, and is not a prerelease.
It fills index.html, install.html, and first-run.html.
SHA-256 values come only from that release's SHA256SUMS asset. Sizes come
from the GitHub asset metadata for the same filenames.

A release that is missing a required installer or a hash fails the command.
"""

from __future__ import annotations

import json
import os
import re
import sys
import urllib.request
from pathlib import Path

REPO = "Boom-Vitt/nose-erp"
API = f"https://api.github.com/repos/{REPO}/releases?per_page=20"
TAG_RE = re.compile(r"^boombignose-v\d+\.\d+\.\d+$")
SUM_RE = re.compile(r"^([a-f0-9]{64}) [ *](\S+)\s*$")
USER_AGENT = "boombignose-fill-release"

# Primary Linux file is the tar.gz. The AppImage is the alternate.
REQUIRED = {
    "windows": "BoomBigNose-windows-x64-setup.exe",
    "macos": "BoomBigNose-macos-arm64.dmg",
    "linux": "BoomBigNose-linux-amd64.tar.gz",
    "appimage": "BoomBigNose-linux-amd64.AppImage",
}
ARCH = {
    "windows": ("windows", "x64"),
    "macos": ("macos", "arm64"),
    "linux": ("linux", "amd64"),
    "appimage": ("linux", "amd64"),
}

ROOT = Path(__file__).resolve().parent
HTML_FILES = (ROOT / "index.html", ROOT / "install.html", ROOT / "first-run.html")
JSON_PATH = ROOT / "release.json"
SCRIPT_OPEN = '<script id="bbn-release" type="application/json">'


def request_headers() -> dict[str, str]:
    headers = {"User-Agent": USER_AGENT, "Accept": "application/vnd.github+json"}
    token = os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN") or ""
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return headers


def fetch(url: str) -> bytes:
    request = urllib.request.Request(url, headers=request_headers())
    with urllib.request.urlopen(request, timeout=60) as response:
        return response.read()


def verify_command(key: str, name: str) -> str:
    if key == "windows":
        return f"Get-FileHash .\\{name} -Algorithm SHA256"
    if key == "macos":
        return "shasum -a 256 -c SHA256SUMS"
    return "sha256sum -c SHA256SUMS"


def build_release(release: dict, sums_text: str) -> dict:
    if release.get("draft") or release.get("prerelease"):
        raise SystemExit("refusing a draft or prerelease")
    tag = release.get("tag_name") or ""
    if not TAG_RE.match(tag):
        raise SystemExit(f"unexpected tag {tag!r}")
    sums: dict[str, str] = {}
    for line in sums_text.splitlines():
        line = line.strip()
        if not line:
            continue
        match = SUM_RE.match(line)
        if not match:
            raise SystemExit(f"SHA256SUMS line is not understood: {line!r}")
        digest, filename = match.group(1), match.group(2)
        sums[filename] = digest
    by_name = {item.get("name"): item for item in release.get("assets") or []}
    assets: dict[str, dict] = {}
    for key, filename in REQUIRED.items():
        item = by_name.get(filename)
        digest = sums.get(filename)
        if item is None or not digest:
            raise SystemExit(f"release {tag} is missing {filename}")
        size = int(item.get("size") or 0)
        url = item.get("browser_download_url") or ""
        if size < 1_000_000 or not url.startswith("https://github.com/"):
            raise SystemExit(f"release {tag} asset {filename} has no usable size or URL")
        os_name, arch = ARCH[key]
        assets[key] = {
            "os": os_name,
            "arch": arch,
            "name": filename,
            "url": url,
            "size": size,
            "sha256": digest,
            "verify": verify_command(key, filename),
        }
    sums_asset = by_name.get("SHA256SUMS")
    if sums_asset is None:
        raise SystemExit(f"release {tag} is missing SHA256SUMS")
    notes = release.get("html_url") or f"https://github.com/{REPO}/releases/tag/{tag}"
    return {
        "tag": tag,
        "notes_url": notes,
        "sums_url": sums_asset.get("browser_download_url"),
        "assets": assets,
    }


def asset_names(release: dict) -> set[str]:
    return {item.get("name") for item in release.get("assets") or []}


def is_candidate(release: dict) -> bool:
    tag = release.get("tag_name") or ""
    if release.get("draft") or release.get("prerelease") or not TAG_RE.match(tag):
        return False
    names = asset_names(release)
    return "SHA256SUMS" in names and set(REQUIRED.values()) <= names


def select_release(releases: list) -> dict:
    for release in releases:
        if is_candidate(release):
            return release
    raise SystemExit("no published boombignose-vX.Y.Z release with installers and SHA256SUMS")


def byte_text(size: int) -> str:
    return f"{size:,} ไบต์"


def line_text(release: dict, key: str) -> str:
    asset = release["assets"][key]
    return f"{asset['arch']} · {release['tag']} · {byte_text(asset['size'])}"


def text_values(release: dict) -> dict[str, str]:
    assets = release["assets"]
    values = {"tag": release["tag"]}
    for key, asset in assets.items():
        values[f"sha-{key}"] = asset["sha256"]
        values[f"size-{key}"] = byte_text(asset["size"])
        values[f"name-{key}"] = asset["name"]
        values[f"line-{key}"] = line_text(release, key)
        values[f"verify-{key}"] = asset["verify"]
    return values


def href_values(release: dict) -> dict[str, str]:
    values = {"notes": release["notes_url"], "sums": release["sums_url"]}
    for key, asset in release["assets"].items():
        values[key] = asset["url"]
    return values


def fill_html(html: str, release: dict, payload: str) -> str:
    start = html.find(SCRIPT_OPEN)
    end = html.find("</script>", start if start >= 0 else 0)
    if start < 0 or end < 0:
        raise SystemExit("page is missing the bbn-release script")
    html = html[: start + len(SCRIPT_OPEN)] + payload + html[end:]
    texts = text_values(release)
    hrefs = href_values(release)

    def replace_text(match: re.Match[str]) -> str:
        key = match.group("key")
        if key not in texts:
            raise SystemExit(f"unknown data-release {key}")
        return match.group("open") + escape_text(texts[key]) + match.group("close")

    text_re = re.compile(
        r'(?P<open><(?P<tag>[a-zA-Z0-9]+)[^>]*\bdata-release="(?P<key>[^"]+)"[^>]*>)(?P<body>.*?)(?P<close></(?P=tag)>)',
        re.DOTALL,
    )
    html, text_count = text_re.subn(replace_text, html)

    def replace_href(match: re.Match[str]) -> str:
        key = match.group("key")
        if key not in hrefs:
            raise SystemExit(f"unknown data-release-href {key}")
        return match.group("open") + escape_attr(hrefs[key]) + match.group("close")

    href_re = re.compile(
        r'(?P<open>data-release-href="(?P<key>[^"]+)"\s+href=")(?P<body>[^"]*)(?P<close>")'
    )
    html, href_count = href_re.subn(replace_href, html)
    if text_count < 1 or href_count < 1:
        raise SystemExit("page has no release placeholders")
    for asset in release["assets"].values():
        if asset["sha256"] not in html or asset["url"] not in html:
            raise SystemExit(f"page did not receive {asset['name']}")
    if release["tag"] not in html:
        raise SystemExit("page did not receive the tag")
    return html


def escape_text(value: str) -> str:
    return value.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def escape_attr(value: str) -> str:
    return escape_text(value).replace('"', "&quot;")


def load_latest() -> dict:
    releases = json.loads(fetch(API).decode("utf-8"))
    if not isinstance(releases, list):
        raise SystemExit("GitHub releases response was not a list")
    release = select_release(releases)
    sums_asset = next((item for item in release.get("assets") or [] if item.get("name") == "SHA256SUMS"), None)
    if sums_asset is None:
        raise SystemExit(f"{release.get('tag_name')} has no SHA256SUMS asset")
    sums_text = fetch(sums_asset["browser_download_url"]).decode("utf-8")
    return build_release(release, sums_text)


def write_outputs(release: dict) -> None:
    payload = json.dumps(release, indent=2, sort_keys=True)
    if "</script>" in payload:
        raise SystemExit("release JSON would close the script tag")
    JSON_PATH.write_text(payload + "\n", encoding="utf-8")
    for path in HTML_FILES:
        filled = fill_html(path.read_text(encoding="utf-8"), release, payload)
        path.write_text(filled, encoding="utf-8")
        print(f"filled {path.name} from {release['tag']}")


def self_test() -> None:
    release = {
        "tag_name": "boombignose-v9.9.9",
        "draft": False,
        "prerelease": False,
        "html_url": "https://github.com/Boom-Vitt/nose-erp/releases/tag/boombignose-v9.9.9",
        "assets": [
            {"name": name, "size": 2_000_000, "browser_download_url": f"https://github.com/{REPO}/releases/download/boombignose-v9.9.9/{name}"}
            for name in (*REQUIRED.values(), "SHA256SUMS")
        ],
    }
    lines = [f"{index:064x}  {name}" for index, name in enumerate(REQUIRED.values(), start=1)]
    built = build_release(release, "\n".join(lines) + "\n")
    assert built["assets"]["windows"]["verify"].startswith("Get-FileHash")
    assert built["assets"]["macos"]["verify"] == "shasum -a 256 -c SHA256SUMS"
    assert built["assets"]["linux"]["verify"] == "sha256sum -c SHA256SUMS"
    assert built["assets"]["appimage"]["sha256"] == f"{4:064x}"
    sample = (
        '<a data-release-href="windows" href="">Windows</a>'
        '<span data-release="tag">old</span>'
        '<span data-release="sha-windows">old</span>'
        '<script id="bbn-release" type="application/json">{}</script>'
    )
    # fill_html requires every asset hash and URL. Give it a complete stub.
    complete = sample
    for key in REQUIRED:
        if key == "windows":
            continue
        complete += f'<a data-release-href="{key}" href=""></a><span data-release="sha-{key}">x</span>'
    complete += '<a data-release-href="sums" href=""></a><a data-release-href="notes" href=""></a>'
    filled = fill_html(complete, built, json.dumps(built, sort_keys=True))
    assert "boombignose-v9.9.9" in filled
    assert built["assets"]["macos"]["url"] in filled
    try:
        select_release([{"tag_name": "boombignose-v1.0.0-rc.1", "draft": False, "prerelease": True}])
    except SystemExit:
        pass
    else:
        raise SystemExit("prerelease should not be selected when it is the only row")
    files = [{"name": name} for name in (*REQUIRED.values(), "SHA256SUMS")]
    chosen = select_release(
        [
            {"tag_name": "boombignose-v9.9.9", "draft": False, "prerelease": False, "assets": []},
            {"tag_name": "boombignose-v1.2.3-rc.1", "draft": False, "prerelease": True, "assets": files},
            {"tag_name": "nightly", "draft": False, "prerelease": False, "assets": files},
            {"tag_name": "boombignose-v1.2.3", "draft": False, "prerelease": False, "assets": files},
        ]
    )
    assert chosen["tag_name"] == "boombignose-v1.2.3"
    assert any(path.name == "first-run.html" for path in HTML_FILES)
    first = (ROOT / "first-run.html").read_text(encoding="utf-8")
    filled_first = fill_html(first, built, json.dumps(built, sort_keys=True))
    assert "boombignose-v9.9.9" in filled_first
    for asset in built["assets"].values():
        assert asset["sha256"] in filled_first
        assert asset["url"] in filled_first
    saved_github = os.environ.pop("GITHUB_TOKEN", None)
    saved_gh = os.environ.pop("GH_TOKEN", None)
    try:
        assert "Authorization" not in request_headers()
        os.environ["GITHUB_TOKEN"] = "self-test-token"
        authed = request_headers()
        assert authed["Authorization"] == "Bearer self-test-token"
        assert "self-test-token" not in json.dumps({k: v for k, v in authed.items() if k != "Authorization"})
    finally:
        os.environ.pop("GITHUB_TOKEN", None)
        if saved_github is not None:
            os.environ["GITHUB_TOKEN"] = saved_github
        if saved_gh is not None:
            os.environ["GH_TOKEN"] = saved_gh
    print("self-test ok")


def main() -> None:
    if "--self-test" in sys.argv:
        self_test()
        return
    write_outputs(load_latest())


if __name__ == "__main__":
    main()
