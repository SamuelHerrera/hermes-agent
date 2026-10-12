"""REST routes for profile-scoped keep-awake control."""

from __future__ import annotations

from contextlib import contextmanager
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from hermes_constants import reset_hermes_home_override, set_hermes_home_override
from hermes_cli.keep_awake import apply_keep_awake, get_keep_awake_state

router = APIRouter()


class KeepAwakeRequest(BaseModel):
    on: bool
    profile: Optional[str] = None


def _resolve_profile_dir(name: str) -> Path:
    from hermes_cli import profiles as profiles_mod

    try:
        profiles_mod.validate_profile_name(name)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not profiles_mod.profile_exists(name):
        raise HTTPException(status_code=404, detail=f"Profile '{name}' does not exist.")
    return profiles_mod.get_profile_dir(name)


@contextmanager
def _profile_scope(profile: Optional[str]):
    requested = (profile or "").strip()
    if not requested or requested.lower() == "current":
        yield None
        return

    token = set_hermes_home_override(str(_resolve_profile_dir(requested)))
    try:
        yield None
    finally:
        reset_hermes_home_override(token)


@router.get("/api/keep-awake")
async def get_keep_awake(profile: Optional[str] = None):
    try:
        with _profile_scope(profile):
            return get_keep_awake_state()
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Could not read keep-awake state: {exc}") from exc


@router.post("/api/keep-awake")
async def set_keep_awake(payload: KeepAwakeRequest, profile: Optional[str] = None):
    requested_profile = profile if profile is not None else payload.profile
    try:
        with _profile_scope(requested_profile):
            return apply_keep_awake(payload.on)
    except HTTPException:
        raise
    except Exception as exc:
        return {"ok": False, "on": False, "desired": payload.on, "error": str(exc)}
