"""The preflight tool must survive the console it was written for.

preflight_proxy.py exists to be run by a human on a Windows machine before
provisioning secrets. On 2026-08-27 it crashed there with UnicodeEncodeError
on its first section header, before executing a single check, because it
printed U+2500 and Windows encodes a redirected stdout with the locale
codepage.

CI cannot catch this: the runners are Linux and UTF-8. So the invariant is
pinned against the source instead — every character the module can print must
survive the narrowest codepage it will plausibly meet.
"""
import os
import re

MODULE = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "debug", "preflight_proxy.py",
)


def _executable_source(text: str) -> str:
    """Everything after the module docstring — i.e. what can reach stdout."""
    first = text.index('"""')
    second = text.index('"""', first + 3)
    return text[second + 3:]


def test_printable_source_is_ascii_only():
    src = _executable_source(open(MODULE, encoding="utf-8").read())
    offenders = sorted({ch for ch in src if ord(ch) > 127})
    assert not offenders, (
        "non-ASCII below the module docstring: "
        + ", ".join(f"U+{ord(c):04X} ({c!r})" for c in offenders)
    )


def test_printed_strings_encode_in_cp437():
    """A second Windows codepage, NOT a narrower one.

    The original version of this docstring called cp437 "the narrowest"
    codepage and justified the test on cp1252 being a superset of it. That is
    wrong, and measurably so:

        cp1252   U+2500 box-drawing  FAILS      U+2014 em dash  encodes
        cp437    U+2500 box-drawing  encodes    U+2014 em dash  FAILS

    Neither contains the other. cp437 would have stayed green on the exact
    character that caused the original crash, because U+2500 is a DOS
    box-drawing glyph and cp437 is the DOS codepage.

    So this test is not the safety net — test_printable_source_is_ascii_only
    is, and it subsumes every codepage. This one exists only to catch a
    regression that reintroduces a cp1252-safe character such as an em dash,
    which the ASCII test would also catch but names less specifically.
    """
    src = _executable_source(open(MODULE, encoding="utf-8").read())
    for literal in re.findall(r'"((?:[^"\\]|\\.)*)"', src):
        literal.encode("cp437")
