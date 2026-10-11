import pytest
from hermes_cli import remote_browser

@pytest.mark.parametrize('url', ['file:///etc/passwd', 'javascript:alert(1)', 'data:text/html,hi', 'about:config', 'ftp://host', 'https://user:pass@host', 'https://', 'http://host\n'])
def test_rejects_unsafe_navigation(url):
    with pytest.raises(ValueError):
        remote_browser.validate_command({'type': 'navigate', 'url': url})

@pytest.mark.parametrize('url', ['about:blank', 'https://example.com', 'http://localhost:8000'])
def test_accepts_backend_web_navigation(url):
    assert remote_browser.validate_command({'type': 'navigate', 'url': url})['url'] == url

def test_limits_viewport_and_input():
    with pytest.raises(ValueError):
        remote_browser.validate_command({'type': 'resize', 'width': 9000, 'height': 9000})
    with pytest.raises(ValueError):
        remote_browser.validate_command({'type': 'type', 'text': 'x' * 17000})
    with pytest.raises(ValueError):
        remote_browser.validate_command({'type': 'evaluate', 'script': 'bad'})
