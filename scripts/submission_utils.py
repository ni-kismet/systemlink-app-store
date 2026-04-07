from __future__ import annotations

import hashlib
import io
import re
import shutil
import subprocess
import tarfile
from email.parser import Parser
from pathlib import Path

SEMVER_RE = re.compile(r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$")
PACKAGE_RE = re.compile(r"^[a-z0-9][a-z0-9._-]*$")
VALID_TYPES = {"webapp", "notebook", "dashboard", "routine", "bundle"}
THIN_MANIFEST_SCHEMA_VERSION = 2

CONTROL_TO_METADATA_KEY = {
    "Package": "package",
    "Version": "version",
    "Description": "description",
    "Section": "section",
    "Maintainer": "maintainer",
    "Homepage": "homepage",
    "XB-DisplayName": "displayName",
    "XB-Plugin": "xbPlugin",
    "XB-SlPluginManagerLicense": "license",
    "XB-SlPluginManagerTags": "slPluginManagerTags",
    "XB-SlPluginManagerMinServerVersion": "slPluginManagerMinServerVersion",
    "XB-SlPluginManagerIcon": "embeddedIcon",
    "Architecture": "architecture",
}

def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as stream:
        for chunk in iter(lambda: stream.read(8192), b""):
            digest.update(chunk)
    return digest.hexdigest()


def md5_file(path: Path) -> str:
    digest = hashlib.md5()
    with open(path, "rb") as stream:
        for chunk in iter(lambda: stream.read(8192), b""):
            digest.update(chunk)
    return digest.hexdigest()


def find_nipkg(submission_dir: Path, manifest: dict[str, Any]) -> Path | None:
    explicit = manifest.get("nipkgFile")
    if explicit:
        candidate = submission_dir / explicit
        return candidate if candidate.is_file() else None

    matches = sorted(submission_dir.glob("*.nipkg"))
    if len(matches) == 1:
        return matches[0]
    return None


def _read_ar_members(path: Path) -> dict[str, bytes]:
    members: dict[str, bytes] = {}
    with open(path, "rb") as stream:
        if stream.read(8) != b"!<arch>\n":
            raise RuntimeError(f"{path} is not a valid ar archive")

        while True:
            header = stream.read(60)
            if not header:
                break
            if len(header) != 60:
                raise RuntimeError(f"{path} has a truncated ar header")
            if header[58:60] != b"`\n":
                raise RuntimeError(f"{path} has an invalid ar header terminator")

            raw_name = header[:16].decode("utf-8", errors="replace").strip()
            size = int(header[48:58].decode("ascii").strip())
            member_data = stream.read(size)
            if len(member_data) != size:
                raise RuntimeError(f"{path} has a truncated ar member")
            if size % 2 == 1:
                stream.read(1)

            member_name = raw_name.rstrip("/")
            members[member_name] = member_data

    return members


def _read_tar_member(control_archive_name: str, control_archive_data: bytes) -> str:
    if control_archive_name.endswith(".zst"):
        control_archive_data = _decompress_zstd(control_archive_data)
        mode = "r:"
    else:
        mode = "r:*"

    with tarfile.open(fileobj=io.BytesIO(control_archive_data), mode=mode) as archive:
        for member in archive.getmembers():
            if Path(member.name).name != "control":
                continue
            extracted = archive.extractfile(member)
            if extracted is None:
                continue
            return extracted.read().decode("utf-8", errors="replace")

    raise RuntimeError("control.tar archive is missing the control file")


def _decompress_zstd(data: bytes) -> bytes:
    try:
        import zstandard
    except ImportError:
        if shutil.which("zstd") is None:
            raise RuntimeError(
                "control.tar.zst is not supported without the zstandard module or zstd CLI"
            )
        result = subprocess.run(
            ["zstd", "-dc"],
            input=data,
            capture_output=True,
            check=False,
        )
        if result.returncode != 0:
            stderr = result.stderr.decode("utf-8", errors="replace").strip()
            raise RuntimeError(stderr or "zstd failed to decompress control.tar.zst")
        return result.stdout

    return zstandard.ZstdDecompressor().decompress(data)


def extract_control_fields(nipkg_path: Path) -> dict[str, str]:
    members = _read_ar_members(nipkg_path)
    control_member_name = next(
        (name for name in members if re.fullmatch(r"control\.tar\.(gz|xz|zst)", name)),
        None,
    )
    if control_member_name is None:
        raise RuntimeError(f"{nipkg_path} is missing control.tar.*")

    control_text = _read_tar_member(control_member_name, members[control_member_name])
    parsed = Parser().parsestr(control_text)
    return {key: value for key, value in parsed.items()}


def metadata_from_control_fields(control_fields: dict[str, str]) -> dict[str, str]:
    metadata: dict[str, str] = {}
    for control_key, metadata_key in CONTROL_TO_METADATA_KEY.items():
        value = control_fields.get(control_key)
        if value:
            metadata[metadata_key] = value

    metadata.setdefault("homepage", "")
    metadata.setdefault("architecture", "all")
    return metadata


def validate_package_metadata(
    metadata: dict[str, str],
    submission_name: str,
    *,
    require_embedded_icon: bool,
) -> list[str]:
    errors: list[str] = []

    package = metadata.get("package", "")
    if not package:
        errors.append(f"[{submission_name}] Package metadata is missing 'Package'")
    elif not PACKAGE_RE.match(package):
        errors.append(f"[{submission_name}] Invalid package name: {package!r}")

    version = metadata.get("version", "")
    if not version:
        errors.append(f"[{submission_name}] Package metadata is missing 'Version'")
    elif not SEMVER_RE.match(version):
        errors.append(f"[{submission_name}] Version is not valid semver: {version!r}")

    description = metadata.get("description", "")
    if len(description) < 20:
        errors.append(
            f"[{submission_name}] Description must be >= 20 characters (got {len(description)})"
        )

    section = metadata.get("section", "")
    if len(section.strip()) < 2:
        errors.append(f"[{submission_name}] Section must be at least 2 characters")

    plugin_type = metadata.get("xbPlugin", "")
    if plugin_type not in VALID_TYPES:
        errors.append(
            f"[{submission_name}] Invalid xbPlugin: {plugin_type!r} (allowed: {VALID_TYPES})"
        )

    if not metadata.get("displayName"):
        errors.append(f"[{submission_name}] Package metadata is missing 'XB-DisplayName'")

    if not metadata.get("maintainer"):
        errors.append(f"[{submission_name}] Package metadata is missing 'Maintainer'")

    if not metadata.get("license"):
        errors.append(
            f"[{submission_name}] Package metadata is missing 'XB-SlPluginManagerLicense'"
        )

    if require_embedded_icon and not metadata.get("embeddedIcon"):
        errors.append(
            f"[{submission_name}] Thin manifests require XB-SlPluginManagerIcon in the .nipkg control metadata"
        )

    return errors
