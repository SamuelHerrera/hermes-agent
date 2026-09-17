"""Installer templates and an empty profile must resolve the same preferences."""

from pathlib import Path

import pytest
import yaml

from hermes_cli.config import DEFAULT_CONFIG, load_config, save_config


PORTABLE_SECTIONS = (
    "model", "agent", "terminal", "tool_output", "tool_loop_guardrails",
    "compression", "display", "delegation", "skills", "moa", "cron",
    "tools", "streaming", "sessions", "desktop", "image_gen", "x_search", "updates",
)


@pytest.mark.parametrize("seed_template", [False, True])
def test_fresh_install_resolves_portable_defaults(tmp_path, monkeypatch, seed_template):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    if seed_template:
        template = Path(__file__).resolve().parents[2] / "cli-config.yaml.example"
        (tmp_path / "config.yaml").write_text(template.read_text(), encoding="utf-8")

    config = load_config()
    for section in PORTABLE_SECTIONS:
        for key, value in DEFAULT_CONFIG[section].items():
            assert config[section][key] == value, f"{section}.{key}"

    # Installing a preference is not installing an identity or granting access.
    assert not (tmp_path / "auth.json").exists()
    assert not config.get("mcp_servers")
    assert config["approvals"]["mode"] != "off"
    assert config["security"]["redact_secrets"] is True


def test_cli_fresh_preferences_match_canonical_defaults(tmp_path, monkeypatch):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    import cli

    monkeypatch.setattr(cli, "_hermes_home", tmp_path)
    config = cli.load_cli_config()
    for section, keys in {
        "model": ("default", "provider"),
        "agent": ("max_turns", "reasoning_effort", "coding_instructions"),
        "terminal": ("timeout",),
        "display": ("personality", "streaming"),
        "delegation": ("max_iterations", "reasoning_effort", "child_timeout_seconds"),
    }.items():
        for key in keys:
            assert config[section].get(key) == DEFAULT_CONFIG[section][key], f"{section}.{key}"


def test_explicit_preferences_survive_save_and_reload(tmp_path, monkeypatch):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    explicit = {
        "_config_version": DEFAULT_CONFIG["_config_version"],
        "model": {"default": "my-model", "provider": "custom"},
        "display": {"personality": "", "streaming": True},
        "desktop": {"repo_scan_enabled": True},
        "sessions": {"auto_archive": False},
        "agent": {"max_turns": 17, "coding_instructions": "my workflow"},
    }
    (tmp_path / "config.yaml").write_text(yaml.safe_dump(explicit), encoding="utf-8")
    save_config(load_config())
    restored = load_config()
    for section, values in explicit.items():
        if isinstance(values, dict):
            for key, value in values.items():
                assert restored[section][key] == value
