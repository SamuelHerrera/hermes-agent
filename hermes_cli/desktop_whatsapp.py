"""Desktop WhatsApp management: read-only health, explicit YAML settings writes.

Never reads auth material into responses, starts a bridge, or restarts a gateway.
Pairing continues to use the existing bounded onboarding flow.
"""
import asyncio
import json
import re
from pathlib import Path
from typing import Literal, Optional

from pydantic import BaseModel, field_validator


class DesktopWhatsAppUpdate(BaseModel):
    enabled: Optional[bool] = None
    mode: Optional[Literal['bot', 'self-chat']] = None
    dm_policy: Optional[Literal['pairing', 'allowlist', 'open', 'disabled']] = None
    allowed_users: Optional[str] = None
    send_read_receipts: Optional[bool] = None
    reply_prefix: Optional[str] = None
    group_policy: Optional[Literal['pairing', 'allowlist', 'open', 'disabled']] = None
    group_allow_from: Optional[str] = None
    require_mention: Optional[bool] = None
    free_response_chats: Optional[str] = None
    mention_patterns: Optional[list[str]] = None
    profile: Optional[str] = None

    @field_validator('mention_patterns')
    @classmethod
    def validate_patterns(cls, value):
        for pattern in value or []:
            try:
                re.compile(pattern, re.IGNORECASE)
            except re.error as exc:
                raise ValueError(f'Invalid mention pattern: {exc}') from exc
        return value


_BEHAVIOR_FIELDS = {
    'send_read_receipts': (False, None),
    'reply_prefix': ('⚕ *Hermes Agent*\n────────────\n', 'WHATSAPP_REPLY_PREFIX'),
    'group_policy': ('pairing', 'WHATSAPP_GROUP_POLICY'),
    'group_allow_from': ('', 'WHATSAPP_GROUP_ALLOWED_USERS'),
    'require_mention': (False, 'WHATSAPP_REQUIRE_MENTION'),
    'free_response_chats': ('', 'WHATSAPP_FREE_RESPONSE_CHATS'),
    'mention_patterns': ([], 'WHATSAPP_MENTION_PATTERNS'),
}


def _behavior_settings(extra, shared, env):
    result = {}
    for key, (default, env_key) in _BEHAVIOR_FIELDS.items():
        value = extra.get(key, env.get(env_key, default))
        if key == 'group_allow_from':
            value = extra.get(key, extra.get('groupAllowFrom', ''))
        if key == 'free_response_chats':
            value = extra.get(key, env.get(env_key, shared.get(key, default)))
        if key == 'mention_patterns':
            if key not in extra and isinstance(value, str):
                try:
                    value = json.loads(value)
                except ValueError:
                    value = value.splitlines()
            result[key] = [value] if isinstance(value, str) else value
            continue
        if isinstance(default, bool):
            value = str(value).lower() in {'true', '1', 'yes', 'on'}
        elif isinstance(value, list):
            value = ','.join(str(v) for v in value)
        result[key] = value
    return result


def _settings(ws):
    from hermes_cli.config import read_raw_config
    cfg = read_raw_config()
    gateway = cfg.get('gateway') or {}
    nested = (gateway.get('platforms') or {}).get('whatsapp')
    direct = (cfg.get('platforms') or {}).get('whatsapp')
    platform, extra = {}, {}
    # Mirror load_gateway_config's platform-map merge, then its shared-key
    # bridge. The latter selects one section, not a per-key fallback.
    for block in (nested, direct, gateway.get('whatsapp')):
        if isinstance(block, dict):
            platform.update(block)
            extra.update(block.get('extra') or {})
    legacy = cfg.get('whatsapp')
    shared = next((block for block in (legacy, nested, direct) if isinstance(block, dict)), {})
    for key in ('dm_policy', 'allow_from', 'send_read_receipts', 'reply_prefix', 'group_policy', 'group_allow_from', 'require_mention', 'mention_patterns'):
        if key in shared:
            extra[key] = shared[key]
    if isinstance(legacy, dict) and 'enabled' in legacy:
        platform['enabled'] = legacy['enabled']
    env = ws.load_env()
    # Read only this home's persisted environment; never another profile's process env.
    allowed = extra.get('allow_from', extra.get('allowFrom', env.get('WHATSAPP_ALLOWED_USERS', '')))
    if isinstance(allowed, list):
        allowed = ','.join(str(v) for v in allowed)
    return {
        'enabled': str(env.get('WHATSAPP_ENABLED', platform.get('enabled', False))).lower() in {'true', '1', 'yes', 'on'},
        'mode': extra.get('mode') or env.get('WHATSAPP_MODE') or 'self-chat',
        'dm_policy': extra.get('dm_policy') or env.get('WHATSAPP_DM_POLICY') or 'pairing',
        'allowed_users': str(allowed or ''),
        **_behavior_settings(extra, shared, env),
    }, extra


def _bridge_health(session: Path, port: int):
    """Probe only a bridge whose process command matches this profile + port."""
    from gateway.status import _read_process_cmdline
    import httpx
    try:
        lines = (session / 'bridge.pid').read_text().splitlines()
        pid = int(lines[0])
        if len(lines) > 1 and lines[1]:
            from gateway.status import get_process_start_time
            if str(get_process_start_time(pid)) != lines[1]:
                return {'state': 'unverified'}
        import shlex
        command = shlex.split(_read_process_cmdline(pid) or '')
        def argument(name):
            return command[command.index(name) + 1] if name in command and command.index(name) + 1 < len(command) else None
        if not command or Path(command[0]).name not in {'node', 'node.exe'} or not any(Path(arg).name == 'bridge.js' for arg in command[1:]) or argument('--session') != str(session) or argument('--port') != str(port):
            return {'state': 'unverified'}
        with httpx.Client(timeout=2.0, trust_env=False) as client:
            response = client.get(f'http://127.0.0.1:{port}/health')
            response.raise_for_status()
            data = response.json()
        state = data.get('status')
        return {'state': state if state in {'connected', 'connecting', 'disconnected', 'qr'} else 'unknown',
                'pid': pid, 'port': port, 'queue_length': data.get('queueLength'),
                'send_read_receipts': data.get('sendReadReceipts')}
    except (OSError, ValueError, IndexError, AttributeError, httpx.HTTPError):
        return {'state': 'unavailable'}


async def get_desktop_whatsapp(profile: Optional[str] = None):
    from hermes_cli import web_server as ws
    def read():
        with ws._config_profile_scope(profile):
            settings, extra = _settings(ws)
            session = Path(extra.get('session_path') or ws._whatsapp_session_path())
            account_id, name, phone = ws._whatsapp_linked_account_from_session(session)
            return {'settings': settings, 'paired': (session / 'creds.json').exists(),
                    'account_id': account_id, 'account_name': name, 'account_phone': phone,
                    'bridge': _bridge_health(session, int(extra.get('bridge_port', 3000)))}
    return await asyncio.to_thread(read)


async def update_desktop_whatsapp(body: DesktopWhatsAppUpdate, profile: Optional[str] = None):
    from hermes_cli import web_server as ws
    def save():
        with ws._CONFIG_MUTATION_LOCK, ws._config_profile_scope(body.profile or profile):
            # Use canonical config helpers; remove only explicitly replaced legacy
            # values so they cannot shadow the new YAML on the next gateway start.
            from hermes_cli.config import read_raw_config
            cfg = read_raw_config()
            platform = cfg.setdefault('platforms', {}).setdefault('whatsapp', {})
            extra = platform.setdefault('extra', {})
            gateway = cfg.get('gateway') or {}
            sections = [platform, cfg.get('whatsapp'), gateway.get('whatsapp'),
                        (gateway.get('platforms') or {}).get('whatsapp')]
            def clear_field(*keys):
                for section in sections:
                    if isinstance(section, dict):
                        for key in keys:
                            section.pop(key, None)
                            if isinstance(section.get('extra'), dict):
                                section['extra'].pop(key, None)
            replaced = []
            for field, key in [('mode', 'WHATSAPP_MODE'), ('dm_policy', 'WHATSAPP_DM_POLICY'), ('allowed_users', 'WHATSAPP_ALLOWED_USERS')]:
                value = getattr(body, field)
                if value is not None:
                    target = 'allow_from' if field == 'allowed_users' else field
                    if field == 'allowed_users':
                        value = [v.strip() for v in value.split(',') if v.strip()]
                    clear_field(*(('allow_from', 'allowFrom') if field == 'allowed_users' else (target,)))
                    extra[target] = value
                    replaced.append(key)
            if body.enabled is not None:
                clear_field('enabled')
                platform['enabled'] = body.enabled
                replaced.append('WHATSAPP_ENABLED')
            for field, (_, env_key) in _BEHAVIOR_FIELDS.items():
                value = getattr(body, field)
                if value is None:
                    continue
                aliases = (field, 'groupAllowFrom') if field == 'group_allow_from' else (field,)
                clear_field(*aliases)
                if field in {'group_allow_from', 'free_response_chats'}:
                    value = [v.strip() for v in value.split(',') if v.strip()]
                extra[field] = value
                if env_key:
                    replaced.append(env_key)
            ws.save_config(cfg)
            for key in replaced:
                ws.remove_env_value(key)
        return {'ok': True, 'needs_restart': True}
    return await asyncio.to_thread(save)
