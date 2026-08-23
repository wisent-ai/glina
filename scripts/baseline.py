#!/usr/bin/env python3
"""Generate released-surface.json for Glina (@wisent-ai/glina) from the best tier.

The baseline describes the version *actually published*, never the version the
manifest happens to declare. Preference runs down the adoption guide's table:

    npm-tarball:<registry path>   a tarball the registry serves, as it addresses it
    gh-release:<tag>     an asset attached to a GitHub Release
    git-archive:<tag>    a tag, reproduced with ``git archive``
    head:<full sha>      the working revision -- last resort

The first whitespace-delimited token of ``source`` is the marker; everything
after the first space is prose for humans.

THREE THINGS THIS FILE IS CAREFUL ABOUT
---------------------------------------
1. The package name is read out of package.json and asserted non-empty. It is
   never a literal inside a URL. npm answers absence generically -- plain
   ``{"error": "Not found"}``, which does not name what you asked for -- so a
   stale or empty name reads as proven absence, and a gate that hardcodes a
   name keeps interrogating the old one after a rename, going green while it
   validates somebody else's package.

   Probe the manifest ``name``, never a console-script name and never a
   convenient respelling. Both matter here. The manifest name is
   ``game_asset_creator`` with underscores, while this package installs
   scripts called ``game-asset-create`` and ``game-asset-mcp`` and its own
   README talks about a hyphenated project -- and on npm underscore and hyphen
   are simply different packages. Measured against the registry: every one of
   those spellings, hyphenated and scoped variants included, is absent, so
   nothing is being missed today. But a sibling repository in this fleet
   installs a script whose name *is* somebody else's published package, and a
   probe spelled with the bin name would have recovered a stranger's tarball
   and filed its surface as that project's baseline. The registry must echo
   back the exact name we asked for before any answer counts as published.

2. Absence is read from the answer's *content*, in three states: named,
   stated-absent, unproven. ``curl``-style "it failed, so nothing is
   published" is fail-open -- it concludes absence precisely when no request
   succeeded. A positive control runs first, through the identical code path
   and the identical request shape, so that a probe which can no longer
   recognise a package the registry certainly serves blames itself instead of
   the registry. That is the fail-closed twin, and it is just as invisible.

Third, and this is the one the fleet corrected after the first draft of this
   file: the marker carries the tarball's **registry path**, taken from
   ``dist.tarball`` in the registry document and never assembled from the
   package name, and never reduced to a basename. Three traps sit in that one
   decision.

   The registry serves a scoped package's tarball under its *unscoped*
   filename -- ``@types/node`` yields ``node-<version>.tgz`` -- so a marker
   built from the scope mismatches forever against a healthy artifact.

   The basename alone is not unique: ``express`` and ``@types/express`` both
   serve ``express-<version>.tgz``, two different packages with different
   owners and different contracts. A marker exists to identify the artifact a
   baseline came from, and ``--assert-current`` compares the whole marker on
   every registry tier, so a non-unique marker cannot do that job.

   And the *lookup* is still the full scoped name from package.json. The
   filename drops the scope; the request must not. Stripping a scope to query
   does not fail closed -- ``@types/node`` and ``node`` are both real packages
   that answer -- so it would validate a stranger's project. For this package
   the same asymmetry bites in plain ASCII: on npm ``game_asset_creator`` and
   ``game-asset-creator`` are different names, and both are absent.
"""

from __future__ import annotations

import argparse
import io
import json
import subprocess
import sys
import tarfile
import tempfile
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
DEFAULT_ROOT = HERE.parent
sys.path.insert(len(""), str(HERE))

from surface import ScanError, surface  # noqa: E402

NPM_REGISTRY = "https://registry.npmjs.org"
GITHUB_API = "https://api.github.com"

# A package the registry certainly serves, in the same request shape as the
# subject (unscoped). It exists to prove this probe can still recognise a
# published package at all.
CONTROL_PACKAGE = "three"

USER_AGENT = "glina-baseline (autoversion adoption)"
TIMEOUT = len("xxxxxxxxxxxxxxxxxxxx")  # seconds

BASELINE_NAME = "released-surface.json"
INDENT = len("xx")
EXIT_OK = len("")


class Unproven(RuntimeError):
    """A probe did not produce testimony we may act on. Never treat as absence."""


class Dishonest(RuntimeError):
    """The committed baseline does not describe the artifact it claims."""


def _get(url: str) -> tuple[int, bytes]:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
            return response.status, response.read()
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read()
    except Exception as exc:  # transport: DNS, TLS, no egress, timeout
        raise Unproven(f"no answer from {url}: {exc!r}") from exc


# --------------------------------------------------------------------------
# npm
# --------------------------------------------------------------------------

def _npm_lookup(name: str) -> tuple[str, dict | None]:
    """Three states: ('named', doc) | ('absent', None) | raise Unproven."""
    if not name:
        raise Unproven(
            "the package name is empty, and npm answers generically, so a lookup "
            "would read as proven absence. Read the name from package.json."
        )
    url = f"{NPM_REGISTRY}/{urllib.parse.quote(name, safe='@')}"
    status, body = _get(url)
    try:
        document = json.loads(body.decode("utf-8", "replace"))
    except ValueError:
        raise Unproven(f"{name}: npm answered http {status} with a non-JSON body") from None
    if isinstance(document, dict) and document.get("name") == name:
        return "named", document
    error = str(document.get("error", "")) if isinstance(document, dict) else ""
    if "not found" in error.lower():
        return "absent", None
    raise Unproven(
        f"{name}: npm answered http {status} but neither named the package nor "
        f"stated it is absent (error={error!r}); its absence is unproven"
    )


def npm_latest(name: str) -> tuple[str, str] | None:
    """(version, tarball_url) for the newest published release, or None."""
    state, _ = _npm_lookup(CONTROL_PACKAGE)
    if state != "named":
        raise Unproven(
            f"this step cannot recognise {CONTROL_PACKAGE!r}, which npm definitely "
            f"serves, so its verdict about {name!r} is meaningless. The check is "
            "broken, not the registry."
        )

    state, document = _npm_lookup(name)
    if state == "absent":
        return None

    latest = (document.get("dist-tags") or {}).get("latest")
    if not latest:
        raise Unproven(f"{name}: npm names the package but publishes no dist-tags.latest")
    release = (document.get("versions") or {}).get(latest) or {}
    tarball = ((release.get("dist") or {}).get("tarball") or "")
    if not tarball:
        raise Unproven(f"{name}@{latest}: npm names the release but serves no dist.tarball")
    return latest, tarball


def registry_path(tarball_url: str) -> str:
    """The path by which the registry addresses a tarball, less its leading slash.

    ``https://registry.npmjs.org/@types/express/-/express-<v>.tgz`` becomes
    ``@types/express/-/express-<v>.tgz``. That is the whole identity of the
    artifact; the basename is not, because a scoped and an unscoped package
    whose names share a tail also share one tarball basename.
    """
    path = urllib.parse.urlparse(tarball_url).path
    stripped = path.lstrip("/")
    if not stripped:
        raise Unproven(f"{tarball_url!r} has no path, so no marker can identify it")
    return stripped


def surface_of_tarball(url: str) -> list[str]:
    """Unpack a published npm tarball and read its surface, tolerantly."""
    _status, payload = _get(url)
    with tempfile.TemporaryDirectory() as work:
        with tarfile.open(fileobj=io.BytesIO(payload), mode="r:gz") as archive:
            archive.extractall(work, filter="data")
        # npm tarballs root everything under "package/".
        root = Path(work) / "package"
        if not (root / "package.json").is_file():
            raise Unproven(f"{url}: no package/package.json inside the tarball")
        return surface(root, tolerant=True)


# --------------------------------------------------------------------------
# git and GitHub
# --------------------------------------------------------------------------

def git(root: Path, *args: str) -> str:
    result = subprocess.run(("git", *args), cwd=root, capture_output=True, text=True)
    if result.returncode:
        raise Unproven(f"git {' '.join(args)} failed: {result.stderr.strip()}")
    return result.stdout.strip()


def head_sha(root: Path) -> str:
    return git(root, "rev-parse", "HEAD")


def origin_slug(root: Path) -> str | None:
    try:
        url = git(root, "remote", "get-url", "origin")
    except Unproven:
        return None
    url = url.removesuffix(".git")
    for prefix in ("https://github.com/", "git@github.com:", "ssh://git@github.com/"):
        if url.startswith(prefix):
            return url.removeprefix(prefix)
    return None


def newest(versions: list[str]) -> str:
    """Order versions with the rule, so the ordering is its answer, not ours."""
    best = next(iter(versions), "")
    for candidate in versions:
        if candidate == best:
            continue
        result = subprocess.run(
            ("autoversion", "order", "--older", best, "--newer", candidate, "--json"),
            capture_output=True, text=True,
        )
        if result.returncode:
            raise Unproven(
                "autoversion order is unavailable, so several tags cannot be "
                "ranked; refusing to guess which is newest"
            )
        if json.loads(result.stdout).get("newer") == candidate:
            best = candidate
    return best


def tag_declared_version(root: Path, tag: str) -> str | None:
    """The version package.json declares in the tree the tag points at."""
    result = subprocess.run(
        ("git", "show", f"{tag}:package.json"), cwd=root, capture_output=True, text=True,
    )
    if result.returncode:
        return None
    try:
        return json.loads(result.stdout).get("version")
    except ValueError:
        return None


def honest_tags(root: Path) -> list[tuple[str, str]]:
    """(tag, version) pairs whose tree really declares the version the tag claims."""
    try:
        listing = git(root, "tag", "--list")
    except Unproven:
        return []
    pairs = []
    for tag in filter(None, (line.strip() for line in listing.splitlines())):
        claimed = tag.removeprefix("v")
        declared = tag_declared_version(root, tag)
        if declared is None:
            print(f"note: tag {tag} has no readable package.json; skipped", file=sys.stderr)
            continue
        if declared != claimed:
            print(
                f"note: tag {tag} points at a tree declaring {declared}; the tag name "
                "disagrees with its own content, so it is reported and skipped",
                file=sys.stderr,
            )
            continue
        pairs.append((tag, claimed))
    return pairs


def surface_of_tag(root: Path, tag: str) -> list[str]:
    """Read the surface out of `git archive <tag>` -- statically, no tooling."""
    result = subprocess.run(
        ("git", "archive", "--format=tar", tag), cwd=root, capture_output=True,
    )
    if result.returncode:
        raise Unproven(
            f"git archive {tag} failed; on a shallow clone the tag's tree is absent, "
            "which is why the workflow unshallows before calling this"
        )
    with tempfile.TemporaryDirectory() as work:
        with tarfile.open(fileobj=io.BytesIO(result.stdout), mode="r:") as archive:
            archive.extractall(work, filter="data")
        return surface(Path(work), tolerant=True)


def github_release_assets(slug: str) -> list[tuple[str, str, str]]:
    """(tag, asset_name, download_url) for every release asset."""
    status, body = _get(f"{GITHUB_API}/repos/{slug}/releases")
    try:
        releases = json.loads(body.decode("utf-8", "replace"))
    except ValueError:
        raise Unproven(f"{slug}: the releases API answered http {status} with a non-JSON body") from None
    if not isinstance(releases, list):
        raise Unproven(f"{slug}: the releases API answered http {status}: {releases}")
    found = []
    for release in releases:
        tag = release.get("tag_name") or ""
        for asset in release.get("assets") or []:
            name = asset.get("name") or ""
            url = asset.get("browser_download_url") or ""
            if tag and name.endswith(".tgz") and url:
                found.append((tag, name, url))
    return found


# --------------------------------------------------------------------------

def candidate_baseline(root: Path) -> dict:
    manifest = json.loads((root / "package.json").read_text(encoding="utf-8"))
    name = (manifest.get("name") or "").strip()
    if not name:
        raise Unproven("package.json declares no name; every registry probe would be meaningless")

    published = npm_latest(name)
    if published is not None:
        version, tarball_url = published
        path = registry_path(tarball_url)
        return {
            "version": version,
            "source": f"npm-tarball:{path} unpacked from the tarball the registry serves for {name}@{version}",
            "surface": surface_of_tarball(tarball_url),
        }

    slug = origin_slug(root)
    if slug:
        assets = github_release_assets(slug)
        if assets:
            tag = newest([tag for tag, _n, _u in assets])
            for candidate_tag, asset_name, url in assets:
                if candidate_tag == tag:
                    return {
                        "version": tag.removeprefix("v"),
                        "source": f"gh-release:{tag} asset {asset_name} attached to the GitHub Release",
                        "surface": surface_of_tarball(url),
                    }

    tags = honest_tags(root)
    if tags:
        version = newest([v for _t, v in tags])
        tag = next(t for t, v in tags if v == version)
        return {
            "version": version,
            "source": f"git-archive:{tag} reproduced with git archive; the tag's tree declares {version}",
            "surface": surface_of_tag(root, tag),
        }

    sha = head_sha(root)
    return {
        "version": manifest.get("version") or "",
        "source": (
            f"head:{sha} nothing is published on npm and the remote carries no tag "
            "and no release, so the working revision is the only artifact there is"
        ),
        "surface": surface(root),
    }


KNOWN_TIERS = ("npm-tarball", "gh-release", "git-archive", "head")


def _committed(root: Path) -> tuple[dict, str, str, str]:
    document = json.loads((root / BASELINE_NAME).read_text(encoding="utf-8"))
    marker, *_prose = str(document.get("source", "")).split(" ")
    tier, _colon, detail = marker.partition(":")
    if tier not in KNOWN_TIERS:
        raise Dishonest(
            f"{BASELINE_NAME} carries the marker {marker!r}, whose tier {tier!r} is not "
            f"one of {', '.join(KNOWN_TIERS)}. An unrecognised marker cannot be checked "
            "in either direction, so it is refused rather than trusted."
        )
    return document, marker, tier, detail


def assert_honest(root: Path) -> None:
    """Guard the baseline against its registry, in both directions.

    A marker that claims a registry must be served there; a marker that claims
    none must not be. The second arm is the one that matters in practice: it
    is what stops a baseline quietly dodging a real release.
    """
    document, marker, tier, detail = _committed(root)
    manifest = json.loads((root / "package.json").read_text(encoding="utf-8"))
    name = (manifest.get("name") or "").strip()
    if not name:
        raise Dishonest("package.json declares no name; the registry guard cannot run")

    published = npm_latest(name)  # runs the positive control, or raises Unproven

    if tier == "npm-tarball":
        if published is None:
            raise Dishonest(
                f"{BASELINE_NAME} claims npm serves {detail!r}, but npm states that "
                f"{name!r} is absent. The baseline names an artifact nobody can install."
            )
        version, tarball_url = published
        path = registry_path(tarball_url)
        if path != detail:
            raise Dishonest(
                f"{BASELINE_NAME} names {detail!r} but npm now serves {path!r} "
                f"for {name}@{version}"
            )
        if document.get("version") != version:
            raise Dishonest(
                f"{BASELINE_NAME} records version {document.get('version')!r} but npm "
                f"serves {version!r} as latest"
            )
    elif published is not None:
        version, _url = published
        raise Dishonest(
            f"{BASELINE_NAME} carries {marker!r}, which claims no registry, but npm "
            f"serves {name}@{version}. The baseline is dodging a real release, so every "
            "later comparison would be measured against the wrong artifact."
        )


def assert_current(root: Path) -> None:
    """Refuse a baseline that is honest but stranded on a lower tier.

    Compare the whole marker on every tier except ``head``, and the tier alone
    on ``head`` -- that is the only tier whose marker moves with every commit
    without the artifact changing, so demanding full equality there would be an
    infinite ratchet.

    This runs entirely in-process on purpose. The shell spelling of this check
    puts the generator inside a command substitution with a pipe, which
    discards its exit status -- so a dead generator yields an empty marker and,
    if the committed marker ever also reads empty, an empty-to-empty comparison
    passes vacuously. Here a failing generator raises and the process exits
    non-zero, and an empty marker cannot reach the comparison because the tier
    allow-list above rejects it first.
    """
    _document, marker, tier, _detail = _committed(root)
    best, *_prose = candidate_baseline(root)["source"].split(" ")
    best_tier, _colon, _rest = best.partition(":")
    if tier == "head":
        want, have = best_tier, tier
    else:
        want, have = best, marker
    if want != have:
        raise Dishonest(
            f"{BASELINE_NAME} is on {have!r} but {want!r} is reachable now. Regenerate "
            "it: the marker is truthful and the baseline is still stale."
        )


def main() -> int:
    parser = argparse.ArgumentParser(description="generate or audit released-surface.json")
    parser.add_argument("--root", default=str(DEFAULT_ROOT))
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument(
        "--stdout", action="store_true",
        help="print the candidate baseline instead of writing it",
    )
    mode.add_argument(
        "--assert-honest", action="store_true",
        help="guard the committed baseline against npm in both directions",
    )
    mode.add_argument(
        "--assert-current", action="store_true",
        help="refuse a committed baseline when a better tier has become reachable",
    )
    args = parser.parse_args()
    root = Path(args.root)

    if args.assert_honest:
        assert_honest(root)
        print("baseline honesty: the marker and the registry agree", file=sys.stderr)
        return EXIT_OK
    if args.assert_current:
        assert_current(root)
        print("baseline tier: still the best reachable artifact", file=sys.stderr)
        return EXIT_OK

    document = candidate_baseline(root)
    rendered = json.dumps(document, indent=INDENT) + "\n"
    if args.stdout:
        sys.stdout.write(rendered)
    else:
        (root / BASELINE_NAME).write_text(rendered, encoding="utf-8")
        marker, *_prose = document["source"].split(" ")
        print(f"wrote {BASELINE_NAME}: {marker}", file=sys.stderr)
    return EXIT_OK


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (Unproven, ScanError, Dishonest) as failure:
        print(f"error: {failure}", file=sys.stderr)
        sys.exit(len("x"))
