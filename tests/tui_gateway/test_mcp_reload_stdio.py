"""Real stdio MCP discovery/reload with a schema change, in a temp Hermes home."""
import json
import sys
import threading
from types import SimpleNamespace

import tools.mcp_tool as mcp
import tui_gateway.server as srv
from tools import mcp_reload_tool
from tools.registry import registry


def test_agent_request_reloads_real_stdio_schema(tmp_path, monkeypatch):
    # Both editions use the SAME tool name: adding connection selectors must
    # refresh the schema, not merely compare tool-name sets.
    script = tmp_path / "fixture.py"
    first = '''from mcp.server.fastmcp import FastMCP
server = FastMCP("reload-fixture")
@server.tool()
def tabs() -> str:
    return "fixture-v1"
server.run()
'''
    second = '''from mcp.server.fastmcp import FastMCP
server = FastMCP("reload-fixture")
@server.tool()
def tabs(connectionId: str = "") -> str:
    return "fixture-v2:" + connectionId
server.run()
'''
    script.write_text(first)
    (tmp_path / "config.yaml").write_text(json.dumps({"tools": {"tool_search": False}, "mcp_servers": {"reload_fixture": {
        "command": sys.executable, "args": [str(script)], "timeout": 10, "connect_timeout": 10,
    }}}))
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    monkeypatch.setattr(srv, "_session_uses_compute_host", lambda _: False)
    monkeypatch.setattr(srv, "_load_enabled_toolsets", lambda: ["mcp-reload_fixture"])
    monkeypatch.setattr(srv, "_session_info", lambda *a: {})
    events = []
    monkeypatch.setattr(srv, "_emit", lambda *a: events.append(a))
    agent = SimpleNamespace(tools=[], valid_tool_names=set(), enabled_toolsets=["mcp-reload_fixture"], disabled_toolsets=[])
    session = {"source": "desktop", "session_key": "test", "agent": agent,
               "running": True, "history_lock": threading.Lock()}
    monkeypatch.setattr(srv, "_sessions", {"runtime": session})
    monkeypatch.setattr(mcp_reload_tool, "_request_reload", srv._request_mcp_reload)
    name = "mcp__reload_fixture__tabs"
    try:
        assert "reload_fixture" in mcp._load_mcp_config()
        names = mcp.discover_mcp_tools()
        assert name in names, mcp.get_mcp_status()
        mcp.refresh_agent_mcp_tools(agent)
        assert name in agent.valid_tool_names, (agent.tools, registry.get_entry(name).toolset)
        old = next(t for t in agent.tools if t["function"]["name"] == name)
        assert "connectionId" not in old["function"]["parameters"].get("properties", {})
        script.write_text(second)
        token = srv._current_runtime_session_record.set(session)
        try:
            assert json.loads(mcp_reload_tool.reload_mcp(True))["status"] == "queued"
        finally:
            srv._current_runtime_session_record.reset(token)
        assert next(t for t in agent.tools if t["function"]["name"] == name) == old
        srv._apply_requested_mcp_reload("runtime", session)
        new = next(t for t in agent.tools if t["function"]["name"] == name)
        assert "connectionId" in new["function"]["parameters"]["properties"]
        response = registry.get_entry(name).handler({"connectionId": "profile-b"})
        assert "fixture-v2:profile-b" in response
        assert "refreshed tools" in events[-1][2]["text"]
    finally:
        mcp.shutdown_mcp_servers()
