#!/usr/bin/env python3
"""Serve this folder and open it in a browser.

There is no build step and nothing to install — the game is ES modules and a
canvas — but it does have to come off a web server rather than off the disk,
because the browser refuses to load modules over file://.

So this is a static file server with three small manners the stock one lacks:
it finds a free port instead of failing on a busy one, it opens the browser for
you, and it tells the browser never to cache. That last one matters more than
it sounds: without it you edit a file, hit refresh, and spend ten minutes
debugging the version you already fixed.

    python serve.py            # or double-click run.bat / run.sh
    python serve.py 9000       # if you want a particular port
"""

from __future__ import annotations

import http.server
import os
import socket
import socketserver
import sys
import threading
import webbrowser

FIRST_PORT = 8000
TRIES = 20


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        # Never cache. You are editing these files while they are being served.
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, fmt, *args):
        # One line per file fetched is noise in the window you are watching.
        pass


def free_port(first: int) -> int:
    for port in range(first, first + TRIES):
        with socket.socket() as s:
            try:
                s.bind(("127.0.0.1", port))
                return port
            except OSError:
                continue
    raise SystemExit(f"Nothing free between {first} and {first + TRIES - 1}.")


def main() -> None:
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    asked = int(sys.argv[1]) if len(sys.argv) > 1 else FIRST_PORT
    port = free_port(asked)
    url = f"http://127.0.0.1:{port}/"

    print()
    print("  Room is running. Open this if your browser didn't:")
    print(f"    {url}")
    print(f"    {url}check.html   (the placement rules, checked)")
    print()
    print("  Leave this window open. Close it, or press Ctrl+C, to stop.")
    print()

    if os.environ.get("NO_BROWSER") != "1":
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()

    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("127.0.0.1", port), Handler) as httpd:
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n  Stopped.\n")


if __name__ == "__main__":
    main()
