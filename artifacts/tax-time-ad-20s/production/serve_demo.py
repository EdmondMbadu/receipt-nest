from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
import os
root=Path(__file__).resolve().parents[1]/'demo/dist/browser'
os.chdir(root)
class Handler(SimpleHTTPRequestHandler):
 def do_GET(self):
  path=self.path.split('?')[0]
  if not (root/path.lstrip('/')).is_file(): self.path='/index.html'
  return super().do_GET()
ThreadingHTTPServer(('127.0.0.1',8767),Handler).serve_forever()
