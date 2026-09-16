"""Inline goals are explicit user markers, not examples or path fragments."""
import pytest

from hermes_cli.inline_goal import extract_inline_goal


@pytest.mark.parametrize("text, expected", [
    ("Context first /goal Finish the tests", ("Finish the tests", "Context first Finish the tests")),
    ("Context\n/goal Finish\nand verify", ("Finish\nand verify", "Context\nFinish\nand verify")),
    ("Finish the tests /goal", ("Finish the tests", "Finish the tests")),
    ("Context /GOAL Finish", ("Finish", "Context Finish")),
    ("Example `/goal nope` then /goal Finish", ("Finish", "Example `/goal nope` then Finish")),
])
def test_explicit_inline_markers(text, expected):
    assert extract_inline_goal(text) == expected


@pytest.mark.parametrize("text", [
    "/goal Finish", " /goal status", "No marker", "src/goal stuff", "/tmp/goal stuff",
    "Context /goals stuff", "Context /goal/status", "Context /goal pause",
    "Example `/goal nope`", "Example ``/goal nope``", "Example\n```text\n/goal nope\n```",
    "Example\n~~~\n/goal nope\n~~~", "Example\n```\n/goal nope",
    "Example\n> /goal nope", "Example\n    /goal nope", "Example\n\t/goal nope",
    "Context /goal First /goal Second", " /goal ", None,
])
def test_non_commands_are_not_executed(text):
    assert extract_inline_goal(text) is None
