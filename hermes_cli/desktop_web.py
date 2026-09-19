"""Authenticated browser-Desktop SPA mount shared by dashboard serving."""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Callable

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

DESKTOP_WEB_DIST = Path(__file__).parent / "desktop_web_dist"
IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable"


class _ImmutableAssetFiles(StaticFiles):
    async def get_response(self, path: str, scope):
        if os.environ.get("HERMES_SERVE_HEADLESS") == "1":
            return JSONResponse({"error": "Headless backend (hermes serve): Desktop web UI disabled"}, status_code=404)
        response = await super().get_response(path, scope)
        if response.status_code == 200:
            response.headers["Cache-Control"] = IMMUTABLE_CACHE_CONTROL
        return response


def mount_desktop_spa(
    application: FastAPI,
    *,
    session_token: str,
    normalise_prefix: Callable[[str | None], str],
) -> None:
    """Serve the Desktop renderer under ``/desktop`` without owning auth.

    The parent FastAPI app's Host/Origin and auth middleware remain authoritative.
    No token endpoint is added: loopback auth is bootstrapped into the document,
    while gated deployments receive only the cookie-auth mode flag.
    """

    @application.get("/desktop/api/{full_path:path}")
    async def missing_desktop_api(full_path: str):
        return JSONResponse(
            {"detail": f"No such API endpoint: /desktop/api/{full_path}"},
            status_code=404,
        )

    # Keep the mount present even before a browser bundle has been built. The
    # StaticFiles directory is resolved at request time from the stable package
    # location; check_dir=False preserves headless/package import behavior.
    application.mount(
        "/desktop/assets",
        _ImmutableAssetFiles(directory=DESKTOP_WEB_DIST / "assets", check_dir=False),
        name="desktop-assets",
    )

    @application.get("/desktop/{full_path:path}")
    async def serve_desktop(full_path: str, request: Request):
        if os.environ.get("HERMES_SERVE_HEADLESS") == "1":
            return JSONResponse(
                {"error": "Headless backend (hermes serve): Desktop web UI disabled"},
                status_code=404,
            )
        index_path = DESKTOP_WEB_DIST / "index.html"
        try:
            html = index_path.read_text(encoding="utf-8")
        except OSError:
            return JSONResponse(
                {"error": "Desktop frontend not built. Run: cd apps/desktop && npm run build:browser"},
                status_code=404,
            )

        prefix = normalise_prefix(request.headers.get("x-forwarded-prefix"))
        gated = bool(getattr(request.app.state, "auth_required", False))
        bootstrap: dict[str, object] = {
            "authRequired": gated,
            "basePath": prefix,
        }
        if not gated:
            bootstrap["sessionToken"] = session_token
        script = (
            "<script>window.__HERMES_DESKTOP_BOOTSTRAP__="
            + json.dumps(bootstrap, separators=(",", ":"))
            + ";</script>"
        )

        asset_root = f"{prefix}/desktop/assets/"
        html = html.replace('src="./assets/', f'src="{asset_root}')
        html = html.replace('href="./assets/', f'href="{asset_root}')
        html = html.replace('src="/assets/', f'src="{asset_root}')
        html = html.replace('href="/assets/', f'href="{asset_root}')
        html = html.replace("</head>", f"{script}</head>", 1)
        return HTMLResponse(
            html,
            headers={"Cache-Control": "no-store, no-cache, must-revalidate"},
        )
