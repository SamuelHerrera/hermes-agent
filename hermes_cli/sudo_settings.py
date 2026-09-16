"""Write-only sudo credential settings, scoped by the caller's Hermes home."""
from __future__ import annotations

import json
import os
from pathlib import Path
import socket
import stat

from fastapi import HTTPException
from hermes_constants import get_hermes_home
from hermes_cli.config import (
    _CONFIG_LOCK, is_managed, load_config, load_env, remove_env_value,
    save_config, save_env_value,
)


def require_writable() -> None:
    from hermes_cli import managed_scope
    keys = ("sudo_credentials_source", "sudo_password_file", "sudo_password_files")
    if is_managed() or any(managed_scope.is_key_managed("terminal." + key) for key in keys):
        raise HTTPException(403, "Sudo settings are administrator managed")


def parse_files(value) -> dict[str, str]:
    if isinstance(value, str):
        try:
            value = json.loads(value) if value.strip() else {}
        except ValueError:
            raise HTTPException(400, "Invalid sudo password-file mapping") from None
    if not isinstance(value, dict) or any(
        not isinstance(k, str) or not k.strip() or k != k.strip()
        or any(c.isspace() for c in k) or not isinstance(v, str) or not v.strip()
        for k, v in value.items()
    ):
        raise HTTPException(400, "Expected host names mapped to file paths")
    return value


def file_availability(value: str) -> str:
    if not value:
        return "unset"
    try:
        path = Path(os.path.expandvars(os.path.expanduser(value)))
        mode = path.stat().st_mode
        if not stat.S_ISREG(mode):
            return "not_regular"
        return "available" if os.access(path, os.R_OK) else "unreadable"
    except FileNotFoundError:
        return "missing"
    except (OSError, ValueError):
        return "unreadable"


def status() -> dict:
    terminal = load_config().get("terminal", {})
    files = parse_files(terminal.get("sudo_password_files", {}))
    file = terminal.get("sudo_password_file", "") or ""
    return {
        "owner": {"host": socket.gethostname(), "home": str(get_hermes_home())},
        "password_set": "SUDO_PASSWORD" in load_env(),
        "file": file,
        "files": files,
        "file_availability": file_availability(file),
        "availability": {host: file_availability(path) for host, path in files.items()},
    }


def set_files(file: str, files) -> dict:
    require_writable()
    files = parse_files(files)
    if not isinstance(file, str) or any("\0" in path for path in [file, *files.values()]):
        raise HTTPException(400, "Invalid file path")
    with _CONFIG_LOCK:
        config = load_config()
        config.setdefault("terminal", {}).update({
            "sudo_password_file": file.strip(), "sudo_password_files": files,
            "sudo_credentials_source": "profile",
        })
        save_config(config)
        return status()


def write_host_password(host: str, password: str, overwrite: bool = False) -> dict:
    """Create/replace only dedicated profile-owned files; never edit a reference.

    Directory-fd operations prevent a symlink swap from redirecting the write.
    Arbitrary external files can be referenced but cannot be overwritten here.
    """
    import re
    import secrets
    require_writable()
    if not isinstance(host, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}", host):
        raise HTTPException(400, "Invalid host name")
    if not isinstance(password, str) or not password or len(password) > 8192 or any(c in password for c in "\r\n\0"):
        raise HTTPException(400, "Password must be nonempty and single-line")
    if type(overwrite) is not bool:
        raise HTTPException(400, "Overwrite must be explicitly confirmed")
    if not hasattr(os, "O_NOFOLLOW") or not os.supports_dir_fd:
        raise HTTPException(400, "Secure password-file writes are unavailable on this backend; reference an existing file")
    with _CONFIG_LOCK:
        home = get_hermes_home()
        directory = home / "sudo-passwords"
        home.mkdir(parents=True, exist_ok=True)
        try:
            directory.mkdir(mode=0o700)
        except FileExistsError:
            pass
        dir_fd = None
        temporary = "." + secrets.token_hex(16)
        try:
            dir_fd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
            info = os.fstat(dir_fd)
            if info.st_uid != os.getuid() or info.st_mode & 0o077:
                raise HTTPException(400, "Credential directory must be owner-only")
            filename = host + ".password"
            try:
                existing = os.stat(filename, dir_fd=dir_fd, follow_symlinks=False)
            except FileNotFoundError:
                existing = None
            if existing is not None:
                if not stat.S_ISREG(existing.st_mode) or existing.st_nlink != 1 or existing.st_uid != os.getuid() or existing.st_mode & 0o077:
                    raise HTTPException(400, "Credential file must be a private, owner-owned regular file")
                if not overwrite:
                    raise HTTPException(409, "Credential file exists; confirm replacement")
            fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=dir_fd)
            with os.fdopen(fd, "w", encoding="utf-8") as stream:
                stream.write(password)
                stream.flush()
                os.fsync(stream.fileno())
            if overwrite:
                os.replace(temporary, filename, src_dir_fd=dir_fd, dst_dir_fd=dir_fd)
            else:
                # Atomic no-clobber publish, including a concurrent creator.
                os.link(temporary, filename, src_dir_fd=dir_fd, dst_dir_fd=dir_fd)
                os.unlink(temporary, dir_fd=dir_fd)
            config = load_config()
            terminal = config.setdefault("terminal", {})
            files = parse_files(terminal.get("sudo_password_files", {}))
            files[host] = str(directory / filename)
            terminal.update({"sudo_password_files": files, "sudo_credentials_source": "profile"})
            save_config(config)
            return status()
        except FileExistsError:
            raise HTTPException(409, "Credential file exists; confirm replacement") from None
        except OSError:
            raise HTTPException(400, "Could not securely write credential file") from None
        finally:
            if dir_fd is not None:
                try:
                    os.unlink(temporary, dir_fd=dir_fd)
                except FileNotFoundError:
                    pass
                os.close(dir_fd)


def set_password(password: str | None) -> dict:
    require_writable()
    from hermes_cli import managed_scope
    if is_managed() or managed_scope.is_env_managed("SUDO_PASSWORD"):
        raise HTTPException(403, "Sudo credential is administrator managed")
    if password is not None and (not password or any(c in password for c in "\r\n\0")):
        raise HTTPException(400, "Password must be nonempty and single-line")
    with _CONFIG_LOCK:
        # Disk is authoritative after UI management: a removal must not resurrect
        # the process's startup .env value in a long-lived backend.
        config = load_config()
        config.setdefault("terminal", {})["sudo_credentials_source"] = "profile"
        save_config(config)
        if password is None:
            remove_env_value("SUDO_PASSWORD", update_process_env=False)
        else:
            save_env_value("SUDO_PASSWORD", password, update_process_env=False)
        return status()
