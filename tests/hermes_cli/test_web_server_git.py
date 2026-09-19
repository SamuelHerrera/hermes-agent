import subprocess
from pathlib import Path

import pytest

from hermes_cli import web_server

pytest.importorskip("starlette.testclient")
from starlette.testclient import TestClient


@pytest.fixture
def client():
    previous = getattr(web_server.app.state, "auth_required", None)
    web_server.app.state.auth_required = False
    test_client = TestClient(web_server.app)
    test_client.headers[web_server._SESSION_HEADER_NAME] = web_server._SESSION_TOKEN
    try:
        yield test_client
    finally:
        if previous is None:
            try:
                delattr(web_server.app.state, "auth_required")
            except AttributeError:
                pass
        else:
            web_server.app.state.auth_required = previous


def _git(repo: Path, *args: str) -> None:
    subprocess.run(["git", *args], cwd=repo, check=True, capture_output=True)


@pytest.fixture
def repo(tmp_path):
    root = tmp_path / "repo"
    root.mkdir()
    _git(root, "init", "-q")
    _git(root, "config", "user.email", "t@example.com")
    _git(root, "config", "user.name", "Test")
    (root / "a.txt").write_text("one\ntwo\n")
    _git(root, "add", "-A")
    _git(root, "commit", "-qm", "init")
    # A tracked modification + a brand-new untracked file (the new-file case the
    # rail/review must surface).
    (root / "a.txt").write_text("one\ntwo\nthree\n")
    (root / "new.py").write_text("print(1)\nprint(2)\n")
    return root










def test_stage_commit_roundtrip_clears_changes(client, repo):
    assert client.post("/api/git/review/stage", json={"path": str(repo), "file": "a.txt"}).json() == {"ok": True}
    staged = client.get("/api/git/status", params={"path": str(repo)}).json()
    assert staged["staged"] >= 1

    assert client.post(
        "/api/git/review/commit", json={"path": str(repo), "message": "tracked change", "push": False}
    ).json() == {"ok": True}

    after = client.get("/api/git/status", params={"path": str(repo)}).json()
    # The tracked change is committed; only the untracked file remains.
    assert after["changed"] == 1
    assert after["untracked"] == 1






def test_worktree_add_initializes_plain_folder(client, tmp_path):
    folder = tmp_path / "plain-project"
    folder.mkdir()
    (folder / "notes.txt").write_text("not committed\n")

    added = client.post(
        "/api/git/worktree/add", json={"path": str(folder), "branch": "feature/plain"}
    ).json()

    assert added["branch"] == "feature/plain"
    assert Path(added["path"]).is_dir()
    assert (folder / ".git").exists()
    _git(folder, "rev-parse", "--verify", "HEAD")

    status = client.get("/api/git/status", params={"path": str(folder)}).json()
    assert status["branch"] == status["defaultBranch"]
    assert status["branch"]
    # Existing files are not silently committed by repo initialization.
    assert any(file["path"] == "notes.txt" and file["untracked"] for file in status["files"])




def test_git_endpoints_require_auth(repo):
    unauth = TestClient(web_server.app)

    assert unauth.get("/api/git/status", params={"path": str(repo)}).status_code == 401
    assert unauth.post("/api/git/review/stage", json={"path": str(repo)}).status_code == 401
    assert unauth.post("/api/git/scan", json={"roots": [str(repo)]}).status_code == 401
    assert unauth.post(
        "/api/git/review/pr-comment",
        json={"path": str(repo), "url": "https://github.com/o/r/pull/1#issuecomment-2"},
    ).status_code == 401


def test_scan_route_hardens_all_paths_and_reuses_web_git(client, repo, tmp_path, monkeypatch):
    excluded = tmp_path / "excluded"
    excluded.mkdir()
    seen = {}

    def fake_scan(roots, options):
        seen.update(roots=roots, options=options)
        return [{"root": roots[0], "label": "repo"}]

    monkeypatch.setattr(web_server._web_git, "scan_repos", fake_scan)
    response = client.post(
        "/api/git/scan",
        json={
            "roots": [str(repo)],
            "enabled": True,
            "maxDepth": 2,
            "excludePaths": [str(excluded)],
        },
    )

    assert response.status_code == 200
    assert response.json() == {"repos": [{"root": str(repo), "label": "repo"}]}
    assert seen == {
        "roots": [str(repo)],
        "options": {"enabled": True, "maxDepth": 2, "excludePaths": [str(excluded)]},
    }


def test_pr_comment_route_uses_hardened_repo_path(client, repo, monkeypatch):
    seen = {}

    def fake_fetch(path, url):
        seen.update(path=path, url=url)
        return {"author": "sam", "url": url}

    monkeypatch.setattr(web_server._web_git, "review_fetch_pr_comment", fake_fetch)
    url = "https://github.com/o/r/pull/1#issuecomment-2"
    response = client.post("/api/git/review/pr-comment", json={"path": str(repo), "url": url})

    assert response.status_code == 200
    assert response.json() == {"comment": {"author": "sam", "url": url}}
    assert seen == {"path": str(repo), "url": url}


def test_git_route_rejects_non_local_file_url(client):
    response = client.post("/api/git/scan", json={"roots": ["file://attacker/etc"]})
    assert response.status_code == 400
