#!/usr/bin/env python3
"""Rebuild the Packages index from thin submission manifests and .nipkg artifacts."""

from __future__ import annotations

import argparse
import base64
import gzip
import json
import mimetypes
import os
import shutil
import sys
import tempfile
import urllib.error
import urllib.request
from pathlib import Path

from submission_utils import (
    THIN_MANIFEST_SCHEMA_VERSION,
    extract_control_fields,
    find_nipkg,
    md5_file,
    metadata_from_control_fields,
    sha256_file,
    validate_package_metadata,
)

REPO_ROOT = Path(__file__).resolve().parent.parent
SUBMISSIONS_DIR = REPO_ROOT / "submissions"
PACKAGES_PATH = REPO_ROOT / "Packages"
PACKAGES_GZ_PATH = REPO_ROOT / "Packages.gz"
MAX_SCREENSHOTS = 3


def base64_encode_file(path: Path) -> str:
    mime, _ = mimetypes.guess_type(str(path))
    if mime is None:
        mime = "image/svg+xml" if path.suffix.lower() == ".svg" else "application/octet-stream"
    with open(path, "rb") as stream:
        encoded = base64.b64encode(stream.read()).decode("ascii")
    return f"data:{mime};base64,{encoded}"


def download_file(url: str, dest: Path) -> None:
    request = urllib.request.Request(
        url,
        headers={"User-Agent": "systemlink-plugin-manager-index-builder"},
    )
    with urllib.request.urlopen(request, timeout=120) as response:
        with open(dest, "wb") as stream:
            shutil.copyfileobj(response, stream)


def get_repo_url(args_repo_url: str | None) -> str:
    if args_repo_url:
        return args_repo_url.rstrip("/")

    github_repository = os.environ.get("GITHUB_REPOSITORY")
    if github_repository:
        return f"https://github.com/{github_repository}"

    return "https://github.com/ni-kismet/systemlink-plugin-manager"


def load_manifest(manifest_path: Path) -> dict:
    with open(manifest_path) as stream:
        return json.load(stream)


def validate_manifest(manifest: dict, submission_dir: Path) -> list[str]:
    errors: list[str] = []
    name = submission_dir.name

    if manifest.get("schemaVersion") != THIN_MANIFEST_SCHEMA_VERSION:
        errors.append(f"[{name}] schemaVersion must be {THIN_MANIFEST_SCHEMA_VERSION}")

    if not manifest.get("nipkgFile"):
        errors.append(f"[{name}] Missing required field: nipkgFile")

    if not manifest.get("sha256"):
        errors.append(f"[{name}] Missing required field: sha256")

    screenshots = manifest.get("screenshots", [])
    if len(screenshots) > MAX_SCREENSHOTS:
        errors.append(f"[{name}] screenshots may contain at most {MAX_SCREENSHOTS} items")

    for screenshot in screenshots:
        screenshot_path = submission_dir / screenshot
        if not screenshot_path.is_file():
            errors.append(f"[{name}] screenshot does not exist: {screenshot!r}")

    return errors


def resolve_nipkg_path(submission_dir: Path, manifest: dict, repo_url: str) -> Path | None:
    local_path = find_nipkg(submission_dir, manifest)
    if local_path is not None:
        return local_path

    release_tag = manifest.get("releaseTag")
    nipkg_file = manifest.get("nipkgFile")
    if not release_tag or not nipkg_file:
        return None

    downloaded_path = Path(tempfile.mkdtemp(prefix="rebuild-index-")) / nipkg_file
    artifact_url = f"{repo_url}/releases/download/{release_tag}/{nipkg_file}"
    download_file(artifact_url, downloaded_path)
    return downloaded_path


def load_submission(
    submission_dir: Path, repo_url: str
) -> tuple[dict, dict[str, str], Path | None, list[str]]:
    manifest_path = submission_dir / "manifest.json"
    errors: list[str] = []

    try:
        manifest = load_manifest(manifest_path)
    except (json.JSONDecodeError, OSError) as exc:
        return {}, {}, None, [f"[{submission_dir.name}] Failed to read manifest.json: {exc}"]

    errors.extend(validate_manifest(manifest, submission_dir))
    if errors:
        return manifest, {}, None, errors

    try:
        nipkg_path = resolve_nipkg_path(submission_dir, manifest, repo_url)
        if nipkg_path is None or not nipkg_path.is_file():
            errors.append(
                f"[{submission_dir.name}] Could not resolve .nipkg artifact {manifest.get('nipkgFile', '')!r}"
            )
            return manifest, {}, None, errors

        actual_sha256 = sha256_file(nipkg_path)
        if actual_sha256 != manifest["sha256"]:
            errors.append(f"[{submission_dir.name}] sha256 does not match the submitted .nipkg")
            return manifest, {}, None, errors

        control_fields = extract_control_fields(nipkg_path)
        metadata = metadata_from_control_fields(control_fields)
        errors.extend(
            validate_package_metadata(
                metadata,
                submission_dir.name,
                require_embedded_icon=True,
            )
        )
        return manifest, metadata, nipkg_path, errors
    except (RuntimeError, urllib.error.URLError) as exc:
        errors.append(f"[{submission_dir.name}] {exc}")
        return manifest, {}, None, errors


def build_stanza(
    manifest: dict,
    metadata: dict[str, str],
    nipkg_path: Path,
    repo_url: str,
    submission_dir: Path,
) -> str:
    package = metadata["package"]
    version = metadata["version"]
    release_tag = manifest.get("releaseTag") or f"{package}-v{version}"
    filename = manifest["nipkgFile"]
    filename_url = f"{repo_url}/releases/download/{release_tag}/{filename}"

    lines = [
        f"Architecture: {metadata.get('architecture', 'all')}",
        f"Description: {metadata['description']}",
        f"Filename: {filename_url}",
        f"Homepage: {metadata.get('homepage', '')}",
        f"MD5sum: {md5_file(nipkg_path)}",
        f"Maintainer: {metadata['maintainer']}",
        f"Package: {package}",
        f"Section: {metadata['section']}",
        f"SHA256: {sha256_file(nipkg_path)}",
        f"Size: {nipkg_path.stat().st_size}",
        f"Version: {version}",
    ]

    attrs = {
        "XB-DisplayName": metadata["displayName"],
        "XB-DisplayVersion": version,
        "XB-Plugin": metadata["xbPlugin"],
        "XB-UserVisible": "yes",
        "XB-SlPluginManagerLicense": metadata["license"],
        "XB-SlPluginManagerIcon": metadata["embeddedIcon"],
    }
    if metadata.get("slPluginManagerTags"):
        attrs["XB-SlPluginManagerTags"] = metadata["slPluginManagerTags"]
    if metadata.get("slPluginManagerMinServerVersion"):
        attrs["XB-SlPluginManagerMinServerVersion"] = metadata[
            "slPluginManagerMinServerVersion"
        ]

    for index, screenshot in enumerate(manifest.get("screenshots", []), start=1):
        screenshot_path = submission_dir / screenshot
        if screenshot_path.is_file():
            attrs[f"XB-SlPluginManagerScreenshot{index}"] = base64_encode_file(
                screenshot_path
            )

    for key, value in sorted(attrs.items()):
        if value:
            lines.append(f"{key}: {value}")

    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description="Rebuild Packages index from submissions/")
    parser.add_argument(
        "--repo-url",
        help="GitHub repository URL for constructing release asset URLs",
    )
    parser.add_argument(
        "--validate-only",
        action="store_true",
        help="Only validate manifests and packages, don't write Packages files",
    )
    args = parser.parse_args()

    repo_url = get_repo_url(args.repo_url)
    if not SUBMISSIONS_DIR.is_dir():
        print("No submissions/ directory found. Creating empty Packages file.")
        PACKAGES_PATH.write_text("")
        return 0

    all_errors: list[str] = []
    stanzas: list[str] = []
    seen_packages: dict[str, str] = {}

    submission_dirs = sorted(
        path
        for path in SUBMISSIONS_DIR.iterdir()
        if path.is_dir() and (path / "manifest.json").is_file()
    )

    for submission_dir in submission_dirs:
        manifest, metadata, nipkg_path, errors = load_submission(submission_dir, repo_url)
        all_errors.extend(errors)
        if errors:
            continue

        package = metadata["package"]
        if package in seen_packages:
            all_errors.append(
                f"[{submission_dir.name}] Duplicate package name '{package}' (already defined in {seen_packages[package]})"
            )
            continue
        seen_packages[package] = submission_dir.name

        assert nipkg_path is not None
        stanzas.append(build_stanza(manifest, metadata, nipkg_path, repo_url, submission_dir))

    if all_errors:
        print("Validation errors:", file=sys.stderr)
        for error in all_errors:
            print(f"  ✗ {error}", file=sys.stderr)
        return 1

    if args.validate_only:
        print(f"✓ {len(stanzas)} submission(s) validated successfully.")
        return 0

    packages_content = "\n\n".join(stanzas)
    if packages_content:
        packages_content += "\n"
    PACKAGES_PATH.write_text(packages_content)
    print(f"✓ Wrote {PACKAGES_PATH} ({len(stanzas)} package(s))")

    with gzip.open(PACKAGES_GZ_PATH, "wt", encoding="utf-8") as stream:
        stream.write(packages_content)
    print(f"✓ Wrote {PACKAGES_GZ_PATH}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
