from fastapi import FastAPI
from starlette.testclient import TestClient


def test_keep_awake_state_is_profile_scoped(tmp_path, monkeypatch):
    from hermes_constants import get_hermes_home
    from hermes_cli.web_routers.keep_awake import router
    import hermes_cli.profiles as profiles
    import hermes_cli.keep_awake as keep_awake

    home = tmp_path / ".hermes"
    profile_home = home / "profiles" / "work"
    profile_home.mkdir(parents=True)
    monkeypatch.setenv("HERMES_HOME", str(home))
    monkeypatch.setattr(profiles, "profile_exists", lambda name: name == "work")
    monkeypatch.setattr(profiles, "get_profile_dir", lambda name: profile_home)
    monkeypatch.setattr(keep_awake, "_start_caffeinate", lambda: None)
    monkeypatch.setattr(keep_awake, "_stop_caffeinate", lambda: None)
    monkeypatch.setattr(keep_awake, "_system_active", lambda: keep_awake.read_desired_keep_awake())

    app = FastAPI()
    app.include_router(router)
    client = TestClient(app)

    assert client.get("/api/keep-awake").json()["on"] is False
    response = client.post("/api/keep-awake?profile=work", json={"on": True})

    assert response.status_code == 200
    assert response.json() == {"ok": True, "on": True, "desired": True}
    assert (profile_home / "state" / "keep-awake.json").is_file()
    assert not (get_hermes_home() / "state" / "keep-awake.json").exists()
    assert client.get("/api/keep-awake?profile=work").json()["on"] is True
    assert client.get("/api/keep-awake").json()["on"] is False


def test_parse_macos_sleep_disabled():
    from hermes_cli.keep_awake import parse_macos_sleep_disabled

    assert parse_macos_sleep_disabled(" System-wide power settings:\n SleepDisabled 1\n") is True
    assert parse_macos_sleep_disabled(" System-wide power settings:\n SleepDisabled 0\n") is False
