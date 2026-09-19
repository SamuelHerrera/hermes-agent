import base64
import subprocess
from pathlib import Path

import pytest

from hermes_cli import web_server

pytest.importorskip("starlette.testclient")
from starlette.testclient import TestClient


@pytest.fixture
def client(monkeypatch):
    previous_auth_required = getattr(web_server.app.state, "auth_required", None)
    web_server.app.state.auth_required = False
    test_client = TestClient(web_server.app)
    test_client.headers[web_server._SESSION_HEADER_NAME] = web_server._SESSION_TOKEN
    try:
        yield test_client
    finally:
        if previous_auth_required is None:
            try:
                delattr(web_server.app.state, "auth_required")
            except AttributeError:
                pass
        else:
            web_server.app.state.auth_required = previous_auth_required


def test_fs_list_sorts_and_hides_noise(client, tmp_path):
    root = tmp_path / "project"
    root.mkdir()
    (root / "b.txt").write_text("b")
    (root / "a_dir").mkdir()
    (root / "a.txt").write_text("a")
    (root / "node_modules").mkdir()
    (root / ".git").mkdir()

    response = client.get("/api/fs/list", params={"path": str(root)})

    assert response.status_code == 200
    entries = response.json()["entries"]
    assert [entry["name"] for entry in entries] == ["a_dir", "a.txt", "b.txt"]
    assert entries[0] == {"name": "a_dir", "path": str(root / "a_dir"), "isDirectory": True}
    assert all(entry["name"] not in {".git", "node_modules"} for entry in entries)


def test_fs_read_data_url_rejects_over_cap(client, tmp_path, monkeypatch):
    monkeypatch.setattr(web_server, "_FS_DATA_URL_MAX_BYTES", 3)
    target = tmp_path / "image.png"
    target.write_bytes(b"1234")

    response = client.get("/api/fs/read-data-url", params={"path": str(target)})

    assert response.status_code == 413


def test_fs_read_and_write_text_parity(client, tmp_path):
    target = tmp_path / "notes.txt"

    write_response = client.post("/api/fs/write-text", json={"path": str(target), "content": "héllo"})
    read_response = client.get("/api/fs/read-text", params={"path": str(target)})

    assert write_response.status_code == 200
    assert write_response.json() == {"ok": True, "path": str(target), "byteSize": 6}
    assert read_response.status_code == 200
    assert read_response.json()["text"] == "héllo"
    assert read_response.json()["byteSize"] == 6


def test_fs_write_rejects_missing_parent_and_directories(client, tmp_path):
    missing_parent = client.post(
        "/api/fs/write-text",
        json={"path": str(tmp_path / "missing" / "notes.txt"), "content": "no"},
    )
    directory = client.post("/api/fs/write-text", json={"path": str(tmp_path), "content": "no"})

    assert missing_parent.status_code == 400
    assert directory.status_code == 400


def test_fs_endpoints_require_auth(tmp_path):
    client = TestClient(web_server.app)
    target = tmp_path / "secret.txt"
    target.write_text("secret")

    list_response = client.get("/api/fs/list", params={"path": str(tmp_path)})
    read_response = client.get("/api/fs/read-text", params={"path": str(target)})
    default_response = client.get("/api/fs/default-cwd")
    rename_response = client.post("/api/fs/rename", json={"path": str(target), "newName": "renamed.txt"})
    trash_response = client.post("/api/fs/trash", json={"path": str(target)})

    assert list_response.status_code == 401
    assert read_response.status_code == 401
    assert default_response.status_code == 401
    assert rename_response.status_code == 401
    assert trash_response.status_code == 401


def test_fs_rename_stays_in_parent_rejects_collisions_and_offloads(client, tmp_path, monkeypatch):
    source = tmp_path / "old.txt"
    source.write_text("old")
    offloaded = []

    original_to_thread = web_server.asyncio.to_thread

    async def recording_to_thread(fn, *args):
        offloaded.append((fn, args))
        return await original_to_thread(fn, *args)

    monkeypatch.setattr(web_server.asyncio, "to_thread", recording_to_thread)

    response = client.post("/api/fs/rename", json={"path": str(source), "newName": "new.txt"})

    assert response.status_code == 200
    assert response.json() == {"ok": True, "path": str(tmp_path / "new.txt")}
    assert not source.exists()
    assert (tmp_path / "new.txt").read_text() == "old"
    assert offloaded == [(web_server._fs_rename_sync, (source, "new.txt"))]

    collision = tmp_path / "collision.txt"
    collision.write_text("occupied")
    response = client.post(
        "/api/fs/rename",
        json={"path": str(tmp_path / "new.txt"), "newName": "collision.txt"},
    )
    assert response.status_code == 409


@pytest.mark.parametrize("new_name", ["", ".", "..", "../escape", "nested/name", "nested\\name"])
def test_fs_rename_rejects_invalid_basename(client, tmp_path, new_name):
    source = tmp_path / "old.txt"
    source.write_text("old")

    response = client.post("/api/fs/rename", json={"path": str(source), "newName": new_name})

    assert response.status_code == 400
    assert source.exists()


def test_fs_trash_uses_hardened_path_and_offloads_blocking_work(client, tmp_path, monkeypatch):
    target = tmp_path / "old.txt"
    target.write_text("old")
    calls = []

    async def fake_to_thread(fn, *args):
        calls.append((fn, args))
        return fn(*args)

    def fake_trash(path):
        calls.append(("trash", path))
        path.unlink()

    monkeypatch.setattr(web_server.asyncio, "to_thread", fake_to_thread)
    monkeypatch.setattr(web_server, "_fs_trash_sync", fake_trash)

    response = client.post("/api/fs/trash", json={"path": str(target)})

    assert response.status_code == 200
    assert response.json() == {"ok": True, "path": str(target)}
    assert not target.exists()
    assert calls == [(fake_trash, (target,)), ("trash", target)]


def test_fs_trash_rejects_missing_paths_before_dispatch(client, tmp_path, monkeypatch):
    monkeypatch.setattr(web_server, "_fs_trash_sync", pytest.fail)

    response = client.post("/api/fs/trash", json={"path": str(tmp_path / "missing")})

    assert response.status_code == 404


def test_fs_mutations_reject_filesystem_root(client):
    rename = client.post("/api/fs/rename", json={"path": "/", "newName": "moved-root"})
    trash = client.post("/api/fs/trash", json={"path": "/"})

    assert rename.status_code == 400
    assert trash.status_code == 400


def test_fs_trash_passes_path_as_an_argument_without_shell_parsing(monkeypatch):
    target = Path("/tmp/report; touch injected")
    calls = []

    monkeypatch.setattr(web_server.sys, "platform", "linux")
    monkeypatch.setattr(web_server.shutil, "which", lambda command: "/usr/bin/gio" if command == "gio" else None)

    def fake_run(command, **kwargs):
        calls.append((command, kwargs))
        return subprocess.CompletedProcess(command, 0, "", "")

    monkeypatch.setattr(web_server.subprocess, "run", fake_run)

    web_server._fs_trash_sync(target)

    assert calls == [
        (
            ["/usr/bin/gio", "trash", str(target)],
            {"capture_output": True, "text": True, "timeout": 30, "check": False},
        )
    ]
