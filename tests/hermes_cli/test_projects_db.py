"""Tests for the per-profile Projects store (hermes_cli/projects_db)."""

from __future__ import annotations

import os

import pytest

from hermes_cli import projects_db as pdb


@pytest.fixture
def conn(tmp_path):
    c = pdb.connect(db_path=tmp_path / "projects.db")
    try:
        yield c
    finally:
        c.close()






def test_discovery_policy_change_clears_only_discovered_rows(conn):
    project_id = pdb.create_project(conn, name="Explicit", folders=["/www/explicit"])
    pdb.record_discovered_repos(
        conn, [("/www/scanned", "scanned")], policy_key="policy-a"
    )

    assert pdb.reconcile_discovered_repos_policy(conn, "policy-b") is True
    assert pdb.list_discovered_repos(conn) == []
    assert pdb.get_project(conn, project_id) is not None
    assert pdb.get_discovery_policy_key(conn) == "policy-b"






def test_create_get_list(conn):
    pid = pdb.create_project(conn, name="Hermes Agent", folders=["/tmp/hermes"])
    proj = pdb.get_project(conn, pid)

    assert proj is not None
    assert proj.slug == "hermes-agent"
    assert proj.name == "Hermes Agent"
    # First folder becomes primary.
    assert proj.primary_path == "/tmp/hermes"
    assert [f.path for f in proj.folders] == ["/tmp/hermes"]
    assert proj.folders[0].is_primary is True

    # Lookup by slug too.
    assert pdb.get_project(conn, "hermes-agent").id == pid
    assert len(pdb.list_projects(conn)) == 1


def test_readding_removed_project_restores_settings_with_new_form_values(tmp_path):
    path = tmp_path / "projects.db"
    with pdb.connect_closing(path) as conn:
        pid = pdb.create_project(
            conn, name="Original", folders=[str(tmp_path / "repo"), str(tmp_path / "old")],
            icon="rocket", color="#123456", description="Keep this", board_slug="work",
        )
        before = pdb.get_project(conn, pid)
        pdb.set_active(conn, pid)
        assert pdb.delete_project(conn, pid)
        assert pdb.get_project(conn, pid) is None
        assert pdb.list_projects(conn, include_archived=True) == []
        assert pdb.project_for_path(conn, str(tmp_path / "repo"), include_archived=True) is None
        assert pdb.get_active_id(conn) is None

    with pdb.connect_closing(path) as conn:
        restored_id = pdb.create_project(
            conn, name="Renamed", folders=[str(tmp_path / "repo"), str(tmp_path / "new")],
            primary_path=str(tmp_path / "new"),
        )
        restored = pdb.get_project(conn, restored_id)
        assert restored_id == pid
        assert restored.name == "Renamed"
        assert restored.primary_path == str(tmp_path / "new")
        assert {f.path for f in restored.folders} == {str(tmp_path / "repo"), str(tmp_path / "new")}
        for attr in ("slug", "created_at", "icon", "color", "description", "board_slug"):
            assert getattr(restored, attr) == getattr(before, attr)


def test_readd_matching_does_not_guess_from_name_or_ambiguous_folders(conn, tmp_path):
    shared = str(tmp_path / "shared")
    first = pdb.create_project(conn, name="Same", folders=[shared, str(tmp_path / "one")], icon="rocket")
    second = pdb.create_project(conn, name="Same", folders=[shared, str(tmp_path / "two")], icon="star")
    pdb.delete_project(conn, first)
    pdb.delete_project(conn, second)
    ambiguous = pdb.create_project(conn, name="Same", folders=[shared])
    unrelated = pdb.create_project(conn, name="Same", folders=[str(tmp_path / "other")])
    assert ambiguous not in (first, second)
    assert unrelated not in (first, second)
    assert pdb.get_project(conn, ambiguous).icon is None
    assert pdb.get_project(conn, unrelated).icon is None
    # An exact folder set beats an ambiguous partial overlap, independent of order.
    assert pdb.create_project(conn, name="Exact", folders=[str(tmp_path / "one"), shared]) == first


def test_readd_overrides_settings_and_rolls_back_invalid_input(conn, tmp_path):
    folder = str(tmp_path / "repo")
    pid = pdb.create_project(conn, name="Old", folders=[folder], icon="rocket", color="red")
    pdb.delete_project(conn, pid)
    with pytest.raises(ValueError):
        pdb.create_project(conn, name="Invalid", folders=[folder], board_slug="../bad")
    assert pdb.get_project(conn, pid) is None
    restored = pdb.create_project(conn, name="New", folders=[folder + os.sep], icon="star", color="")
    assert restored == pid
    assert pdb.get_project(conn, pid).icon == "star"
    assert pdb.get_project(conn, pid).color == ""


def test_removed_settings_are_profile_local(tmp_path):
    folder = str(tmp_path / "repo")
    with pdb.connect_closing(tmp_path / "a.db") as a, pdb.connect_closing(tmp_path / "b.db") as b:
        pid = pdb.create_project(a, name="A", folders=[folder], color="red")
        pdb.delete_project(a, pid)
        other = pdb.create_project(b, name="B", folders=[folder])
        assert pdb.get_project(b, other).color is None
        assert pdb.create_project(a, name="A again", folders=[folder]) == pid












def test_project_for_path_skips_archived(conn):
    pid = pdb.create_project(conn, name="P", folders=["/www/app"])
    pdb.archive_project(conn, pid)

    assert pdb.project_for_path(conn, "/www/app/src") is None
    # Archived hidden from the default list but visible with include_archived.
    assert pdb.list_projects(conn) == []
    assert len(pdb.list_projects(conn, include_archived=True)) == 1

    pdb.restore_project(conn, pid)
    assert pdb.project_for_path(conn, "/www/app/src").id == pid






def test_per_profile_isolation(tmp_path):
    # Two distinct DB paths stand in for two profiles' HERMES_HOME.
    a = pdb.connect(db_path=tmp_path / "a" / "projects.db")
    b = pdb.connect(db_path=tmp_path / "b" / "projects.db")
    try:
        pdb.create_project(a, name="Only In A", folders=["/a"])
        pdb.record_discovered_repos(a, [("/a/scanned", "scanned")])

        assert [p.slug for p in pdb.list_projects(a)] == ["only-in-a"]
        assert pdb.list_projects(b) == []
        assert [row["root"] for row in pdb.list_discovered_repos(a)] == [
            "/a/scanned"
        ]
        assert pdb.list_discovered_repos(b) == []
    finally:
        a.close()
        b.close()


