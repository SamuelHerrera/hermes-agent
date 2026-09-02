from pathlib import Path

import yaml


SKILL_PATH = (
    Path(__file__).resolve().parents[2]
    / "optional-skills"
    / "autonomous-ai-agents"
    / "hermes-chrome-bridge"
    / "SKILL.md"
)


def _parts():
    content = SKILL_PATH.read_text(encoding="utf-8")
    _, frontmatter, body = content.split("---", 2)
    return yaml.safe_load(frontmatter), body


def test_frontmatter_meets_optional_skill_contract():
    frontmatter, body = _parts()

    assert frontmatter["name"] == "hermes-chrome-bridge"
    assert len(frontmatter["description"]) <= 60
    assert frontmatter["description"].endswith(".")
    assert frontmatter["platforms"] == ["linux", "macos"]
    assert "Hermes Agent" in frontmatter["author"]
    assert body.strip()


def test_skill_preserves_visible_control_and_sensitive_data_guards():
    _, body = _parts()

    for required in (
        "chrome_bridge_status",
        "chrome_bridge_snapshot",
        "chrome_bridge_eval",
        "Hermes control indicator",
        "Never type passwords",
        "BRIDGE_DISCONNECTED",
        "SENSITIVE_PAGE",
    ):
        assert required in body

    assert "/Users/" not in body
    assert "/home/" not in body
