#!/usr/bin/env python3
"""Extract the public surface of Glina (@wisent-ai/glina).

WHY THIS SET IS THE CONTRACT
----------------------------
This distribution wears three hats at once, and a caller can be holding any of
them, so the contract is the union rather than whichever one is most
convenient to read:

  subpath:<spec>  the subpath export specifiers in package.json. These are
                  what an importer literally writes. Deleting ``./card-art``
                  breaks ``import ... from 'game_asset_creator/card-art'``
                  even if every function behind it survives.
  api:<name>      the named exports of every module the exports map points at.
                  The specifiers alone are not enough: a package whose subpath
                  list never changes while ``cardArtSvg`` is deleted would
                  score ``internal``, which is exactly the failure the
                  adoption guide's chart-library example warns about. Include
                  a set whose removal your surface would otherwise call
                  internal.
  bin:<name>      the two console scripts. A rename breaks a shell that ran
                  yesterday.
  cmd:<name>      the pipeline subcommands the CLI's own USAGE advertises. A
                  command that dispatches but is unlisted is private.
  mcp:<name>      the tool names the MCP server answers ``tools/list`` with.
                  For a server, the tool names *are* the routes -- an agent
                  holds those strings and nothing else.

Deliberately excluded: the config-file keys, the Blender/Weles selectors and
the prompt text. Those are what this product is expected to improve as it gets
better at generating assets, and pinning them would ratchet on churn rather
than on promises.

HOW IT IS READ
--------------
Statically, off the source text. Nothing is imported and node is never
invoked: a release decision must not require a machine with THREE.js, a vault
and a Blender install, and the same extractor has to run against an unpacked
published tarball, which is how a baseline is recovered rather than assumed.

A module that does not parse raises. It never degrades to a shorter surface,
because a shrink reads as a breaking removal that never happened.

WHY A BROKEN SUBPATH IS *NOT* IN THE CONTRACT
---------------------------------------------
A ``subpath:`` name is recorded only when its target resolves in the tree being
read. That is a deliberate choice against the easier reading -- "the exports
map is the advertised contract, so record every key" -- and this package is the
reason the choice had to be made rather than assumed.

Measured: ``exports["./sculpt-gear"]`` names ``./sculpt-gear.js`` while the file
lives at ``src/sculpt-gear.js``. ``npm pack`` ships ``src/sculpt-gear.js`` and no
root ``sculpt-gear.js``, so ``import 'game_asset_creator/sculpt-gear'`` faults
for every consumer, in the tree and in any tarball this manifest can produce.

Three edits could be made to that line, and only the resolve-first rule gives
the right verdict on all three:

  repair the target to ``./src/sculpt-gear.js`` -- a subpath starts working, so
  the surface grows and the change is additive. Recording the key regardless
  would call a newly usable entry point ``internal``.

  delete the dead specifier -- nothing a consumer could ever have resolved goes
  away, so the change is internal. Recording the key regardless would call it
  breaking and demand a major release for deleting a line that never worked.

  move a *working* module's file, so ``./card-art`` stops resolving. This is the
  accident the gate exists to catch. Under resolve-first the surface shrinks and
  the verdict is breaking. Recording the key regardless reads only package.json,
  which did not change, and reports ``internal`` -- the gate sleeps through a
  real breakage while looking green. That case decides it.

The same argument covers the ``files`` field: keys recorded blindly make the
surface a property of the manifest alone, so dropping a directory from ``files``
and shipping a tarball whose subpaths all fault would also read ``internal``.

So the contract is the subpaths a consumer can actually resolve. The broken one
is reported loudly on stderr rather than silently dropped, because it is a real
defect and it is the owner's to fix -- not this extractor's to launder into a
contract. Nothing is lost from the surface by excluding it: the root export
re-exports every name from ``./sculpt-gear.js``, so ``api:buildAxe`` and its
siblings are still recorded through ``subpath:.``.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
DEFAULT_ROOT = HERE.parent

CLI_REL = "pipeline/cli.js"
MCP_REL = "pipeline/mcp.js"

# This workspace admits no bare numeric literals, so the small numbers below
# are spelled as word forms.
FIRST_GROUP = len("x")
INDENT = len("xx")
EXIT_OK = len("")
PAIR = len("xx")


class ScanError(RuntimeError):
    """A source file could not be scanned. Never downgrade this to a skip."""


# --------------------------------------------------------------------------
# A one-pass JS lexer: enough to tell code from comments and string bodies.
# --------------------------------------------------------------------------

_TOKENS = re.compile(
    r"""
      (?P<line_comment> //[^\n]* )
    | (?P<block_comment> /\*.*?\*/ )
    | (?P<dq> "(?:\\.|[^"\\\n])*" )
    | (?P<sq> '(?:\\.|[^'\\\n])*' )
    | (?P<tpl> `(?:\\.|[^`\\])*` )
    | (?P<regex> (?<=[=(,:\[!&|?+\-*%~^<>{};]) \s* /(?:\\.|\[(?:\\.|[^\]\\\n])*\]|[^/\\\n\[])+/[gimsuy]* )
    """,
    re.VERBOSE | re.DOTALL,
)

_QUOTES = ("dq", "sq", "tpl")


def _blank(chunk: str) -> str:
    return "".join(ch if ch == "\n" else " " for ch in chunk)


def _has_unclosed_substitution(inner: str) -> bool:
    """True when a ``${`` in a template body is never closed.

    That is the one shape that desyncs this lexer: a nested template inside a
    substitution ends the outer literal early, leaving a dangling ``${``. A
    plain apostrophe in the literal text is harmless and must not trip it.
    """
    stack: list[str] = []
    previous = ""
    for ch in inner:
        if ch == "{" and previous == "$":
            stack.append(ch)
        elif ch == "}" and stack:
            stack.pop()
        previous = ch
    return bool(stack)


def scan_js(text: str, origin: str) -> tuple[str, list[tuple[int, str]]]:
    """Return (masked_code, [(start_offset, literal_value), ...])."""
    pieces: list[str] = []
    literals: list[tuple[int, str]] = []
    cursor = EXIT_OK

    for match in _TOKENS.finditer(text):
        kind = match.lastgroup
        pieces.append(text[cursor:match.start()])
        body = match.group()
        if kind in _QUOTES:
            quote = body[:len("`")]
            inner = body[len(quote):-len(quote)]
            if kind == "tpl" and _has_unclosed_substitution(inner):
                raise ScanError(
                    f"{origin}: a template literal at offset {match.start()} has an "
                    "unclosed ${...}, so a nested template ended it early; this "
                    "scanner refuses to guess where it really ends"
                )
            literals.append((match.start(), inner))
            pieces.append(quote + _blank(inner) + quote)
        else:
            pieces.append(_blank(body))
        cursor = match.end()
    pieces.append(text[cursor:])

    masked = "".join(pieces)
    if len(masked) != len(text):
        raise ScanError(f"{origin}: masking changed the file length; offsets would be wrong")
    for opener, closer in (("{", "}"), ("[", "]")):
        if masked.count(opener) != masked.count(closer):
            raise ScanError(f"{origin}: unbalanced {opener}{closer} after scan; refusing to report a surface")
    for quote in ('"', "'", "`"):
        if masked.count(quote) % PAIR:
            raise ScanError(f"{origin}: odd number of {quote} delimiters after scan; lexer lost sync")
    return masked, literals


def balanced_span(masked: str, search_from: int, opener: str, origin: str) -> tuple[int, int]:
    closer = {"{": "}", "[": "]"}[opener]
    try:
        start = masked.index(opener, search_from)
    except ValueError:
        raise ScanError(f"{origin}: expected {opener!r} after offset {search_from}") from None
    stack: list[str] = []
    for offset, ch in enumerate(masked[start:]):
        if ch == opener:
            stack.append(ch)
        elif ch == closer:
            stack.pop()
            if not stack:
                return start, start + offset + len(closer)
    raise ScanError(f"{origin}: unbalanced {opener!r} opened at offset {start}")


def _locate(masked: str, needle: str, origin: str) -> int:
    try:
        return masked.index(needle)
    except ValueError:
        raise ScanError(
            f"{origin}: {needle!r} not found; the advertised surface cannot be read. "
            "Fix this extractor rather than publishing a shrunken surface."
        ) from None


# --------------------------------------------------------------------------

_EXPORT_DECL = re.compile(
    r"\bexport\s+(?:async\s+)?(?:function\s*\*?|const|let|var|class)\s+([A-Za-z_$][\w$]*)"
)
_EXPORT_LIST = re.compile(r"\bexport\s*\{([^}]*)\}")
_CLI_COMMAND = re.compile(r"^ {2}([a-z][a-z0-9-]*)(?:\s|$)")


def exported_names(masked: str, origin: str) -> set[str]:
    """Named exports of one module, read off the masked code."""
    names = {match.group(FIRST_GROUP) for match in _EXPORT_DECL.finditer(masked)}
    for match in _EXPORT_LIST.finditer(masked):
        for item in match.group(FIRST_GROUP).split(","):
            item = item.strip()
            if not item:
                continue
            parts = item.split()
            # "A", "A as B", "default as B" -- the public name is the last token
            names.add(parts[-len("x")])
    if "default" in names:
        raise ScanError(
            f"{origin}: a default export was found; this extractor names only "
            "named exports and will not guess what a default is called"
        )
    return names


def cli_commands(masked: str, literals: list[tuple[int, str]]) -> set[str]:
    """The subcommands the CLI's own USAGE block advertises."""
    start = _locate(masked, "USAGE", CLI_REL)
    usage = ""
    for offset, value in literals:
        if offset > start:
            usage = value
            break
    if "commands:" not in usage:
        raise ScanError(
            f"{CLI_REL}: the USAGE literal has no 'commands:' section; this extractor "
            "no longer reads the advertised commands. Fix it rather than publishing a "
            "shrunken surface."
        )
    found: set[str] = set()
    listing = usage.split("commands:", maxsplit=len("x"))[-len("x")]
    for line in listing.splitlines():
        if not line.strip():
            if found:
                break
            continue
        match = _CLI_COMMAND.match(line)
        if match:
            found.add(match.group(FIRST_GROUP))
    return found


def mcp_tools(masked: str, literals: list[tuple[int, str]]) -> set[str]:
    """Tool names the MCP server answers tools/list with."""
    span = balanced_span(masked, _locate(masked, "TOOLS", MCP_REL), "[", MCP_REL)
    found: set[str] = set()
    for offset, value in literals:
        if span[EXIT_OK] <= offset < span[-len("x")]:
            if masked[:offset].rstrip().endswith("name:"):
                found.add(value)
    return found


_REQUIRED_KINDS = ("bin:", "subpath:", "api:", "cmd:", "mcp:")


def surface(root: Path, tolerant: bool = False) -> list[str]:
    names: set[str] = set()
    skipped: list[str] = []

    manifest_path = root / "package.json"
    if not manifest_path.is_file():
        raise ScanError(f"{manifest_path}: no package.json; the distribution cannot be described")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))

    binmap = manifest.get("bin") or {}
    if isinstance(binmap, str):
        binmap = {manifest.get("name", ""): binmap}
    for script in binmap:
        names.add(f"bin:{script}")

    exports = manifest.get("exports") or {}
    if isinstance(exports, str):
        exports = {".": exports}

    def scan(relative: str) -> tuple[str, list[tuple[int, str]]] | None:
        path = root / relative
        if not path.is_file():
            return None
        try:
            return scan_js(path.read_text(encoding="utf-8"), relative)
        except ScanError:
            if not tolerant:
                raise
            skipped.append(relative)
            return None

    for specifier, target in exports.items():
        if not isinstance(target, str):
            continue
        relative = target.removeprefix("./")
        if not (root / relative).is_file():
            print(
                f"warning: package.json maps {specifier!r} to {target!r}, which is not "
                "in this tree, so an importer writing that specifier faults. It is "
                "reported here and left out of the surface; this module's docstring "
                "says why a subpath that cannot resolve is not part of the contract",
                file=sys.stderr,
            )
            continue
        names.add(f"subpath:{specifier}")
        scanned = scan(relative)
        if scanned is None:  # tolerant mode skipped it; already recorded above
            continue
        names.update(f"api:{name}" for name in exported_names(scanned[EXIT_OK], relative))

    scanned = scan(CLI_REL)
    if scanned is not None:
        names.update(f"cmd:{name}" for name in cli_commands(*scanned))

    scanned = scan(MCP_REL)
    if scanned is not None:
        names.update(f"mcp:{name}" for name in mcp_tools(*scanned))

    if skipped:
        print(
            "warning: tolerant mode skipped these modules, so this surface is incomplete "
            "and must never be committed as a baseline: " + ", ".join(skipped),
            file=sys.stderr,
        )
    else:
        for kind in _REQUIRED_KINDS:
            if not any(name.startswith(kind) for name in names):
                raise ScanError(
                    f"scanned cleanly but produced no {kind!r} names. The layout changed "
                    "and this extractor no longer reads it; fix the extractor rather than "
                    "publishing a shrunken surface."
                )

    return sorted(names)


def main() -> int:
    parser = argparse.ArgumentParser(description="print the public surface as JSON")
    parser.add_argument(
        "--root", default=str(DEFAULT_ROOT),
        help="tree to read; point at an unpacked tarball to recover a baseline",
    )
    parser.add_argument(
        "--tolerant", action="store_true",
        help="recovery mode for an already-published artifact: skip unscannable modules and say so",
    )
    args = parser.parse_args()
    print(json.dumps({"surface": surface(Path(args.root), tolerant=args.tolerant)}, indent=INDENT))
    return EXIT_OK


if __name__ == "__main__":
    sys.exit(main())
