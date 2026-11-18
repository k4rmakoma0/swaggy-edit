#!/usr/bin/env python3
"""Update the Swaggy cask from a verified, published GitHub release."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
from urllib.request import Request, urlopen


REPOSITORY = "k4rmakoma0/swaggy-edit"
VERSION = re.compile(r"(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)")


def version_tuple(version):
    if not VERSION.fullmatch(version):
        raise ValueError(f"Expected a stable major.minor.patch version, got {version!r}")
    return tuple(map(int, version.split(".")))


def release_metadata(tag=None):
    if tag:
        if not tag.startswith("v"):
            raise ValueError("Release tags must start with v")
        version_tuple(tag[1:])
    endpoint = f"tags/{tag}" if tag else "latest"
    headers = {"Accept": "application/vnd.github+json", "User-Agent": "swaggy-homebrew"}
    if token := os.environ.get("GH_TOKEN"):
        headers["Authorization"] = f"Bearer {token}"
    request = Request(f"https://api.github.com/repos/{REPOSITORY}/releases/{endpoint}", headers=headers)
    with urlopen(request, timeout=60) as response:
        return json.load(response)


def asset_for(release, name):
    assets = [asset for asset in release["assets"] if asset["name"] == name]
    if len(assets) != 1 or assets[0]["state"] != "uploaded":
        raise ValueError(f"Expected one fully uploaded release asset: {name}")
    asset = assets[0]
    expected_url = f"https://github.com/{REPOSITORY}/releases/download/{release['tag_name']}/{name}"
    if asset["browser_download_url"] != expected_url:
        raise ValueError(f"Unexpected asset URL for {name}")
    return asset


def download(asset, destination):
    request = Request(asset["browser_download_url"], headers={"User-Agent": "swaggy-homebrew"})
    digest = hashlib.sha256()
    size = 0
    with urlopen(request, timeout=60) as response, destination.open("wb") as output:
        while chunk := response.read(1024 * 1024):
            size += len(chunk)
            if size > asset["size"]:
                raise ValueError(f"Download exceeds expected size: {asset['name']}")
            digest.update(chunk)
            output.write(chunk)
    if size != asset["size"] or asset.get("digest") != f"sha256:{digest.hexdigest()}":
        raise ValueError(f"GitHub asset size or SHA-256 mismatch: {asset['name']}")
    return digest.hexdigest()


def render_cask(source, version, checksum):
    if not re.fullmatch(r"[a-f0-9]{64}", checksum):
        raise ValueError("Invalid SHA-256")
    version_tuple(version)
    expected_url = f'  url "https://github.com/{REPOSITORY}/releases/download/v#{{version}}/Swaggy_#{{version}}_universal.dmg"'
    if expected_url not in source.splitlines():
        raise ValueError("Cask download naming changed; review the updater before publishing")
    current = re.findall(r'^  version "([^"]+)"$', source, re.MULTILINE)
    if len(current) != 1 or version_tuple(version) < version_tuple(current[0]):
        raise ValueError("Refusing to downgrade the cask or update an invalid version stanza")
    updated, count = re.subn(r'^  version "[^"]+"$', f'  version "{version}"', source, flags=re.MULTILINE)
    updated, hashes = re.subn(r'^  sha256 "[a-f0-9]{64}"$', f'  sha256 "{checksum}"', updated, flags=re.MULTILINE)
    if count != 1 or hashes != 1:
        raise ValueError("Expected exactly one version and SHA-256 stanza")
    return updated


def update_cask(cask, release, latest):
    if release["draft"] or release["prerelease"]:
        raise ValueError("Only published stable releases can update Homebrew")
    tag = release["tag_name"]
    if not tag.startswith("v"):
        raise ValueError("Release tags must start with v")
    version = tag[1:]
    version_tuple(version)
    if release["id"] != latest["id"]:
        print(f"Skipping {tag}: it is not the latest stable release")
        return False
    name = f"Swaggy_{version}_universal.dmg"
    dmg_asset = asset_for(release, name)
    sums_asset = asset_for(release, "SHA256SUMS.txt")
    source = cask.read_text()
    # Validate the cask shape and downgrade protection before downloading anything.
    render_cask(source, version, "0" * 64)
    with tempfile.TemporaryDirectory(prefix="swaggy-homebrew-") as directory:
        dmg = Path(directory) / name
        sums = Path(directory) / "SHA256SUMS.txt"
        checksum = download(dmg_asset, dmg)
        download(sums_asset, sums)
        entries = [line.split() for line in sums.read_text().splitlines() if line.strip()]
        matches = [entry[0] for entry in entries if len(entry) == 2 and entry[1] == name]
        if matches != [checksum]:
            raise ValueError("SHA256SUMS.txt does not match the final DMG")
        subprocess.run(["codesign", "--verify", "--strict", str(dmg)], check=True)
        subprocess.run(["xcrun", "stapler", "validate", str(dmg)], check=True)
        subprocess.run(["spctl", "--assess", "--type", "open", "--context", "context:primary-signature", str(dmg)], check=True)
    updated = render_cask(source, version, checksum)
    if updated == source:
        print(f"Cask already matches verified release {tag}")
        return False
    cask.write_text(updated)
    print(f"Updated Swaggy cask to {version} ({checksum})")
    return True


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tag", default="")
    parser.add_argument("--cask", type=Path, required=True)
    args = parser.parse_args()
    latest = release_metadata()
    release = release_metadata(args.tag) if args.tag else latest
    changed = update_cask(args.cask, release, latest)
    if output := os.environ.get("GITHUB_OUTPUT"):
        with open(output, "a") as stream:
            stream.write(f"changed={str(changed).lower()}\n")


if __name__ == "__main__":
    main()
