"""Recognize an explicit /goal marker inside a user message."""

import re

# Mask examples before scanning; never execute a command from a code span,
# fenced block, blockquote, or indented code. Keep offsets in the original text.
_EXAMPLES = re.compile(
    r"(?ms)^ {0,3}(`{3,}|~{3,})[^\n]*\n.*?(?:^ {0,3}\1[^\n]*(?:\n|$)|\Z)"
    r"|(?m:^[ \t]*>[^\n]*|^(?: {4}|\t)[^\n]*)"
    r"|(`+)[^`]*?\2"
)
_MARKER = re.compile(r"(?<!\S)/goal(?=\s|$)", re.IGNORECASE)
_CONTROLS = {"status", "pause", "resume", "clear", "stop", "done"}


def extract_inline_goal(text: str) -> tuple[str, str] | None:
    """Return (goal, prompt) for one inline marker, keeping preceding context.

    The tail is the standing goal. A trailing marker adopts the preceding
    message. Leading commands and multiple markers stay with their existing
    handlers rather than guessing which instruction to execute.
    """
    if not isinstance(text, str) or text.lstrip().startswith("/"):
        return None
    masked = _EXAMPLES.sub(lambda match: " " * len(match[0]), text)
    matches = list(_MARKER.finditer(masked))
    if len(matches) != 1:
        return None
    match = matches[0]
    before, after = text[:match.start()], text[match.end():]
    goal = after.strip() or before.strip()
    if not goal or goal.lower() in _CONTROLS:
        return None
    return goal, (before + after.lstrip(" \t")).strip()
