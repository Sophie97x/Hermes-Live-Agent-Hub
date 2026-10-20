"""The local adapter must not expose private state to foreign web pages."""
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch
import httpx
from backend import main, external_agents
from fastapi import FastAPI
from sse_starlette.sse import EventSourceResponse

class RequestBoundaryTests(unittest.IsolatedAsyncioTestCase):
    async def request(self, method, url, *, client=('127.0.0.1', 12345), **kwargs):
        transport = httpx.ASGITransport(app=main.app, client=client)
        async with httpx.AsyncClient(transport=transport, base_url='http://localhost:3001') as http:
            return await http.request(method, url, **kwargs)

    async def test_local_read_and_development_origin_still_work(self):
        with patch.object(main, 'read_health', return_value={'ok': True}):
            response = await self.request('GET', '/api/health', headers={'Origin': 'http://localhost:5174'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {'ok': True})
        self.assertEqual(response.headers['access-control-allow-origin'], 'http://localhost:5174')
        self.assertEqual(response.headers['cache-control'], 'no-store')

    async def test_foreign_origin_and_rebinding_hosts_cannot_reach_handlers(self):
        with patch.object(main, 'read_health') as read, patch.object(external_agents, 'save_settings') as save, patch.object(main, '_restart_hub', new_callable=AsyncMock) as restart:
            for method, url in [('GET', '/api/health'), ('PUT', '/api/settings'), ('POST', '/api/restart')]:
                response = await self.request(method, url, headers={'Origin': 'https://hostile.example'}, json={})
                self.assertEqual(response.status_code, 403)
            response = await self.request('GET', '/api/health', headers={'Host': 'rebound.example:3001'})
            self.assertEqual(response.status_code, 400)
            response = await self.request('POST', '/api/restart', headers={'Sec-Fetch-Site': 'cross-site'})
            self.assertEqual(response.status_code, 403)
            read.assert_not_called(); save.assert_not_called(); restart.assert_not_called()

    async def test_direct_remote_client_is_rejected_even_without_origin(self):
        with patch.dict(os.environ, {'HUB_ALLOW_REMOTE': 'false'}), patch.object(main, 'read_health') as read:
            response = await self.request('GET', '/api/health', client=('203.0.113.9', 12345))
        self.assertEqual(response.status_code, 403)
        read.assert_not_called()

    async def test_local_settings_can_still_relocate_a_source(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(external_agents, 'source_counts', return_value={}):
            settings_file = Path(folder) / 'settings.json'
            custom_home = str(Path(folder) / 'custom-codex')
            with patch.object(external_agents, 'SETTINGS_PATH', settings_file):
                response = await self.request('PUT', '/api/settings', headers={'Origin': 'http://localhost:3001'}, json={'sources': {'codex': {'home': custom_home}}})
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()['settings']['sources']['codex']['home'], custom_home)
            self.assertEqual(json.loads(settings_file.read_text())['sources']['codex']['home'], custom_home)

    async def test_event_stream_still_works_with_the_patched_framework(self):
        probe = FastAPI()
        async def events():
            yield {'event': 'ping', 'data': 'ok'}
        @probe.get('/events')
        async def endpoint():
            return EventSourceResponse(events())
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=probe), base_url='http://localhost') as http:
            response = await http.get('/events')
        self.assertEqual(response.status_code, 200)
        self.assertIn('event: ping', response.text)
        self.assertIn('data: ok', response.text)
