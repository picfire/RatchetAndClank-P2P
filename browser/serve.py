#!/usr/bin/env python3
"""Serves build/browser (only that folder) on 127.0.0.1 with caching off, so a rebuild is always
what the browser runs. Usage: python3 browser/serve.py [port=8777]

POST /__report (from boot-page.mjs when the game stops) appends the report, a small JSON object
with the error, the stopping functions, the frame and the hero's position, to
build/reports/stops.jsonl, outside the served folder. Nothing else is written and no game data is
accepted (64 KiB at most)."""
import functools
import http.server
import json
import os
import sys
import time

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'build', 'browser')
REPORTS = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'build', 'reports')


class NoCache(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, '.wasm': 'application/wasm', '.mjs': 'text/javascript'}

    def do_POST(self):
        if self.path != '/__report':
            self.send_error(404)
            return
        length = int(self.headers.get('Content-Length', '0'))
        if length <= 0 or length > 65536:
            self.send_error(413)
            return
        try:
            report = json.loads(self.rfile.read(length))
        except ValueError:
            self.send_error(400)
            return
        report['received'] = time.strftime('%Y-%m-%d %H:%M:%S')
        os.makedirs(REPORTS, exist_ok=True)
        with open(os.path.join(REPORTS, 'stops.jsonl'), 'a', encoding='utf-8') as handle:
            handle.write(json.dumps(report) + '\n')
        print(f"stop reported: {report.get('message', '')[:160]}", flush=True)
        self.send_response(204)
        self.end_headers()

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()


port = int(sys.argv[1]) if len(sys.argv) > 1 else 8777
handler = functools.partial(NoCache, directory=os.path.normpath(ROOT))
print(f'serving {os.path.normpath(ROOT)} at http://127.0.0.1:{port}/boot.html (no caching)')
http.server.ThreadingHTTPServer(('127.0.0.1', port), handler).serve_forever()
