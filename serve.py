# Local dev server that tells the browser not to cache, so edited JS/CSS modules
# always load fresh. Usage: python3 serve.py [port]
import http.server
import sys
from functools import partial
from pathlib import Path


class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()


port = int(sys.argv[1]) if len(sys.argv) > 1 else 5202
handler = partial(NoCache, directory=str(Path(__file__).parent))
http.server.ThreadingHTTPServer(('127.0.0.1', port), handler).serve_forever()
