#!/usr/bin/env python3
"""
Dev server for the_sphere_project with a live assets listing.

Serves the project folder like `python3 -m http.server` did, plus one
extra endpoint:

    GET /_assets-list  ->  JSON list of image files currently in assets/
                           e.g. ["8k_earth_daymap.jpg", "pokeball.png"]

main.js fetches that endpoint to build the Texture dropdown, then
re-checks it every few seconds - so dropping a new image into
assets/ (or deleting one) shows up in the menu without restarting
anything. Only hidden files and real image extensions are listed.

Usage:  python3 server.py [port]     (default 8471)
"""

import json
import os
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8471

ASSETS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "assets")

IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".bmp"}


def asset_listing():
    try:
        names = sorted(
            f for f in os.listdir(ASSETS_DIR)
            if not f.startswith(".")
            and os.path.splitext(f)[1].lower() in IMAGE_EXTS
            and os.path.isfile(os.path.join(ASSETS_DIR, f))
        )
    except OSError:
        names = []
    return names


class Handler(SimpleHTTPRequestHandler):

    # no-cache everything: the whole point is picking up files that
    # appear/disappear between requests
    cache_control = "no-store"

    def send_header(self, keyword, value):
        if keyword.lower() == "cache-control":
            value = self.cache_control
        super().send_header(keyword, value)

    def do_GET(self):
        if self.path == "/_assets-list":
            body = json.dumps(asset_listing()).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)
            return
        SimpleHTTPRequestHandler.do_GET(self)

    def log_message(self, format, *args):
        # keep the console quiet except real errors
        if "404" in format % args:
            sys.stderr.write("%s - %s\n" % (self.address_string(), format % args))


if __name__ == "__main__":
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"serving on http://localhost:{PORT}  (assets list at /_assets-list)")
    server.serve_forever()
