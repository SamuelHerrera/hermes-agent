"""Managed sudo credentials share the file-tool credential guards."""
import pytest

from agent.file_safety import get_read_block_error, get_write_denied_error


@pytest.mark.parametrize("relative", [
    "sudo-passwords/hp.password",
    "profiles/work/sudo-passwords/hp.password",
    "profiles/other/sudo-passwords/higole.password",
])
def test_managed_passwords_are_not_exposed_by_file_tools(tmp_path, monkeypatch, relative):
    root = tmp_path / "hermes"
    active = root / "profiles" / "work"
    active.mkdir(parents=True)
    monkeypatch.setenv("HERMES_HOME", str(active))
    target = root / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text("synthetic-test-only")
    assert get_read_block_error(str(target))
    assert get_write_denied_error(str(target))


def test_neighboring_documents_remain_accessible(tmp_path, monkeypatch):
    root = tmp_path / "hermes"
    monkeypatch.setenv("HERMES_HOME", str(root))
    document = root / "sudo-passwords-guide.md"
    assert get_read_block_error(str(document)) is None
    assert get_write_denied_error(str(document)) is None
