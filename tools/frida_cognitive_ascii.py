#!/usr/bin/env python3
"""
Tool: frida_cognitive_ascii (frida_cognitive_ascii.py)

Problem:
  Cognitive Testing's Azure createTxtFile API rejects non-ASCII characters in uploaded .txt
  content (HTTP 200 with body "false"). FRIDA scripts and comments often use typographic dashes,
  box-drawing, or other Unicode. This module normalizes text to safe ASCII (known character map,
  NFKD decomposition, then "?" for anything left) so lint and upload stay consistent.

How to use:
  Import from the same directory as the caller (e.g. frida_lint.py, sync_actions_to_cognitive.py):

    from frida_cognitive_ascii import sanitize_for_cognitive_upload
    text_out = sanitize_for_cognitive_upload(text_in)

  Alias for upload scripts: sanitize_for_azure_upload (same function).

  There is no CLI; it is a library module. Consumers:
  - frida_lint.py: rule W019 and format pass
  - sync_actions_to_cognitive.py: default upload path unless --no-sanitize
"""

from __future__ import annotations

import unicodedata

# Typography: Cognitive upload rejects code points > U+007F; merge former W008 SendMail map.
_TRANSLATIONS = str.maketrans(
    {
        "\u2500": "-",  # BOX DRAWINGS LIGHT HORIZONTAL
        "\u2010": "-",  # HYPHEN
        "\u2011": "-",  # NON-BREAKING HYPHEN
        "\u2012": "-",  # FIGURE DASH
        "\u2013": "-",  # EN DASH
        "\u2014": "--",  # EM DASH
        "\u2015": "-",  # HORIZONTAL BAR
        "\u2212": "-",  # MINUS SIGN
        "\u00a0": " ",  # NBSP
        "\u2018": "'",
        "\u2019": "'",
        "\u201c": '"',
        "\u201d": '"',
        "\u201C": '"',
        "\u201D": '"',
    }
)


def sanitize_for_cognitive_upload(text: str) -> str:
    """Map common typography to ASCII, then NFKD-strip; unknown non-ASCII becomes '?'."""
    mapped = text.translate(_TRANSLATIONS)
    out: list[str] = []
    for ch in mapped:
        o = ord(ch)
        if o < 128:
            out.append(ch)
            continue
        decomp = unicodedata.normalize("NFKD", ch)
        ascii_chars = "".join(c for c in decomp if ord(c) < 128)
        out.append(ascii_chars if ascii_chars else "?")
    return "".join(out)


# Backward-compatible alias for upload scripts.
sanitize_for_azure_upload = sanitize_for_cognitive_upload
