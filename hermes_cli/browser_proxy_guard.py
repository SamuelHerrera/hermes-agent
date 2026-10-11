"""Exclude isolated proxy traffic from every Hermes HTTP/WebSocket endpoint."""
from urllib.parse import urlsplit


class ProxyOriginGuard:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        origins = set()
        if scope['type'] in ('http', 'websocket'):
            state = getattr(scope.get('app'), 'state', None)
            proxy = getattr(state, 'browser_proxy', None)
            config = getattr(proxy, 'config', None) or {}
            origins.update(getattr(state, 'browser_proxy_origins', ()))
            origins.update((config.get('origin', ''), getattr(state, 'browser_proxy_origin', '')))
            origins.discard('')
            headers = dict(scope.get('headers', []))
            try:
                hostname = urlsplit('http://' + headers.get(b'host', b'').decode('latin1')).hostname
                source = urlsplit(headers.get(b'origin', b'').decode('latin1')).hostname
            except ValueError:
                hostname = source = None
            proxy_hosts = {urlsplit(origin).hostname for origin in origins}
            # OAuth callbacks are state-checked public top-level navigations,
            # not readable cross-origin API fetches. Preserve the existing MCP
            # provider callback, but never exempt a proxy-origin request.
            callback_navigation = (
                scope.get('method') == 'GET' and
                scope.get('path', '').startswith('/api/mcp/oauth/callback/') and
                headers.get(b'sec-fetch-mode') == b'navigate' and
                headers.get(b'sec-fetch-dest') == b'document'
            )
            cross_site_api = (scope.get('path', '').startswith('/api/') and
                              headers.get(b'sec-fetch-site') == b'cross-site' and
                              not callback_navigation)
            if origins and (source in proxy_hosts or hostname in proxy_hosts or cross_site_api):
                if scope['type'] == 'websocket':
                    await send({'type': 'websocket.close', 'code': 4403, 'reason': 'Proxy origin cannot access Hermes'})
                else:
                    body = b'{"detail":"Proxy origin cannot access Hermes"}'
                    await send({'type': 'http.response.start', 'status': 403, 'headers': [(b'content-type', b'application/json')]})
                    await send({'type': 'http.response.body', 'body': body})
                return
        if origins and scope['type'] == 'http' and scope.get('path', '').startswith('/desktop'):
            async def guarded_send(message):
                if message['type'] == 'http.response.start':
                    message = dict(message)
                    message['headers'] = list(message.get('headers', [])) + [(
                        b'content-security-policy',
                        f"frame-src {' '.join(sorted(origins))} blob: data:; object-src 'none'".encode('ascii'),
                    )]
                await send(message)
            # Never allow 'self': a proxy page must not navigate its controller
            # back to Desktop, gain the parent's origin and steal credentials.
            await self.app(scope, receive, guarded_send)
        else:
            await self.app(scope, receive, send)
