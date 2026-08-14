import time

import pytest

from gateway.platforms.api_server import APIServerAdapter
from hermes_cli.web_routers import profiles, sessions


@pytest.mark.parametrize("helper", [profiles._session_row_running, sessions._session_row_running])
def test_session_row_running_uses_fresh_activity_label_even_after_prior_end(helper):
    now = time.time()

    assert helper(
        {
            "ended_at": now - 600,
            "last_activity_at": now - 10,
            "last_activity_description": "receiving stream response",
            "last_activity_provenance": "unknown",
        },
        now,
    )


@pytest.mark.parametrize("helper", [profiles._session_row_running, sessions._session_row_running])
def test_session_row_running_stops_when_turn_teardown_clears_labels(helper):
    now = time.time()

    assert not helper(
        {
            "ended_at": None,
            "last_activity_at": now - 10,
            "last_activity_description": "",
            "last_activity_provenance": "unknown",
        },
        now,
    )


@pytest.mark.parametrize("helper", [profiles._session_row_running, sessions._session_row_running])
def test_session_row_running_expires_stale_activity_labels(helper):
    now = time.time()

    assert not helper(
        {
            "ended_at": None,
            "last_activity_at": now - 301,
            "last_activity_description": "running a tool",
            "last_activity_provenance": "unknown",
        },
        now,
    )


def test_api_server_session_response_exposes_running_hint_for_fresh_activity_label():
    now = time.time()
    payload = APIServerAdapter._session_response(
        {
            "id": "s1",
            "started_at": now - 600,
            "last_activity_at": now - 10,
            "last_activity_description": "receiving stream response",
            "last_activity_provenance": "unknown",
        }
    )

    assert payload["running"] is True
