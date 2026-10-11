"""Optional isolated Scramjet helper. No browser process runs on the backend."""
import asyncio
import hashlib
import ipaddress
import json
import logging
import os
import subprocess
from pathlib import Path
from urllib.parse import urlsplit

_log = logging.getLogger(__name__)


def install_dependencies(root=None):
    """Install the bundled proxy during installation/update, never during browsing."""
    from hermes_constants import find_node_executable, with_hermes_node_path
    root = Path(root) if root is not None else Path(__file__).with_name('browser_proxy')
    dependencies = json.loads((root / 'package.json').read_text())['dependencies']
    fingerprint = hashlib.sha256(
        (root / 'package.json').read_bytes() + (root / 'package-lock.json').read_bytes()
    ).hexdigest()
    stamp = root / 'node_modules' / '.hermes-proxy-lock.sha256'
    try:
        ready = all(
            json.loads((root / 'node_modules' / name / 'package.json').read_text()).get('version') == version
            for name, version in dependencies.items()
        )
        if ready and stamp.read_text() == fingerprint:
            return False
    except (OSError, ValueError):
        pass
    npm = find_node_executable('npm')
    if not npm:
        raise RuntimeError('Browser proxy installation requires npm; re-run the Hermes installer to provision Node.')
    from hermes_cli._subprocess_compat import windows_hide_flags
    result = subprocess.run(
        [npm, 'ci', '--ignore-scripts', '--workspaces=false', '--no-fund', '--no-audit'],
        cwd=root, timeout=600, env=with_hermes_node_path(), creationflags=windows_hide_flags(),
    )
    if result.returncode:
        raise RuntimeError('Browser proxy dependency installation failed; re-run the installer or hermes update.')
    stamp.parent.mkdir(parents=True, exist_ok=True)
    stamp.write_text(fingerprint)
    return True


def _origin(value):
    parsed = urlsplit(value)
    if (parsed.scheme != 'https' or not parsed.hostname or parsed.username or
            parsed.password or parsed.path not in ('', '/') or parsed.query or parsed.fragment):
        raise ValueError('Browser proxy requires a bare HTTPS origin')
    # Accessing port also validates its syntax and range.
    port = parsed.port
    hostname = parsed.hostname.encode('idna').decode('ascii')
    if ':' in hostname:
        hostname = f'[{hostname}]'
    return f'https://{hostname}' + (f':{port}' if port is not None and port != 443 else '')


def validate_origins(proxy, parent):
    proxy, parent = _origin(proxy), _origin(parent)
    if urlsplit(proxy).hostname == urlsplit(parent).hostname:
        raise ValueError('Browser proxy must use a separate hostname and registrable domain')
    return proxy


def validate_bind(value):
    ip = ipaddress.ip_address(value)
    private = any(ip in network for network in (
        ipaddress.ip_network('10.0.0.0/8'), ipaddress.ip_network('172.16.0.0/12'),
        ipaddress.ip_network('192.168.0.0/16'), ipaddress.ip_network('fc00::/7'),
    ) if network.version == ip.version)
    if ip.is_unspecified or ip.is_multicast or not (ip.is_loopback or private):
        raise ValueError('Browser proxy bind must be a specific loopback or private interface IP')
    return str(ip)


def validate_denied_hosts(value):
    # `hermes config set` stores JSON arrays as strings. Normalize that
    # supported CLI input before the helper iterates DNS hostnames.
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except ValueError as error:
            raise ValueError('Browser proxy denied hosts must be a JSON list of hostnames') from error
    if not isinstance(value, list) or any(not isinstance(host, str) or not host.strip() for host in value):
        raise ValueError('Browser proxy denied hosts must be a list of hostnames')
    return value


class BrowserProxy:
    def __init__(self):
        self.process = None
        self.lock = asyncio.Lock()
        self.config = None
        self.port = None

    async def start(self, desktop):
        origin = desktop.get('browser_proxy_origin', '')
        if not origin:
            raise RuntimeError('Configure desktop.browser_proxy_origin with a separate HTTPS site to enable the browser')
        origin = _origin(origin)
        bind = validate_bind(desktop.get('browser_proxy_bind', '127.0.0.1'))
        port = int(desktop.get('browser_proxy_port', 9120))
        if not 0 <= port <= 65535:
            raise ValueError('Invalid browser proxy port')
        config = {'origin': origin, 'port': port, 'listenHost': bind,
                  'deniedHosts': validate_denied_hosts(desktop.get('browser_proxy_denied_hosts', []))}
        if self.process and self.process.returncode is None and self.config == config:
            return
        await self.stop()
        from hermes_constants import find_node_executable
        node = await asyncio.to_thread(find_node_executable, 'node')
        root = Path(__file__).with_name('browser_proxy')
        if not node or not (root / 'node_modules' / '@mercuryworkshop' / 'scramjet').exists():
            raise RuntimeError('Browser proxy dependencies missing. Re-run the Hermes installer or hermes update (npm ci --ignore-scripts --workspaces=false).')
        self.process = await asyncio.create_subprocess_exec(
            node, str(root / 'server.mjs'), cwd=str(root),
            stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
            env={key: value for key, value in os.environ.items() if key in {
                'PATH', 'HOME', 'TMPDIR', 'TEMP', 'TMP', 'LANG', 'LC_ALL', 'SYSTEMROOT',
            }},
        )
        try:
            result = await self._command(config)
            if result.get('type') != 'ready':
                raise RuntimeError('Optional browser proxy helper unavailable, check port and dependency installation')
            self.config, self.port = config, result['port']
        except BaseException:
            await self.stop()
            raise

    async def _command(self, value):
        self.process.stdin.write((json.dumps(value) + '\n').encode())
        await self.process.stdin.drain()
        line = await asyncio.wait_for(self.process.stdout.readline(), 15)
        if not line or len(line) > 4096:
            raise RuntimeError('Browser proxy helper disconnected')
        return json.loads(line)

    async def bootstrap(self, desktop, parent):
        validate_origins(desktop.get('browser_proxy_origin', ''), parent)
        async with self.lock:
            await self.start(desktop)
            try:
                result = await self._command({'type': 'mint', 'id': 'bootstrap', 'parentOrigin': _origin(parent)})
            except BaseException:
                # A timeout must not leave a late stdio reply that a different
                # request could consume as its own capability.
                await self.stop()
                raise
            if result.get('id') != 'bootstrap' or not result.get('ticket'):
                raise RuntimeError('Browser isolation, capacity or management-host DNS check failed')
            return {key: result[key] for key in ('origin', 'ticket', 'expiresIn')}

    async def stop(self):
        process, self.process = self.process, None
        self.config = None
        self.port = None
        if not process or process.returncode is not None:
            return
        try:
            process.stdin.close()
            await asyncio.wait_for(process.wait(), 3)
        except (TimeoutError, BrokenPipeError):
            process.kill()
            await process.wait()


def desktop_proxy_config():
    from hermes_cli.config import load_config
    return load_config().get('desktop', {})


async def recover_proxy(app):
    proxy = app.state.browser_proxy = BrowserProxy()
    app.state.browser_proxy_origin = ''
    app.state.browser_proxy_origins = set()
    try:
        desktop = await asyncio.to_thread(desktop_proxy_config)
        if desktop.get('browser_proxy_origin'):
            app.state.browser_proxy_origin = _origin(desktop['browser_proxy_origin'])
            await proxy.start(desktop)
    except Exception as error:
        _log.warning('Optional browser proxy unavailable: %s', error)


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description='Install bundled Hermes browser proxy dependencies')
    parser.add_argument('--install', action='store_true', required=True)
    parser.parse_args()
    try:
        installed = install_dependencies()
        print('Browser proxy dependencies installed' if installed else 'Browser proxy dependencies already current')
    except (OSError, RuntimeError, subprocess.SubprocessError) as error:
        parser.exit(1, f'{error}\n')
