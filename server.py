#!/usr/bin/env python3
"""
Loop Line dev server.

Serves the game AND stores progress in a real file next to it — one file per
player, progress-<name>.json, so two people playing on the same machine never
share a save and never overwrite each other's.
A browser page cannot write to disk on its own — but the server handing it the
page can, so the page POSTs its progress here and this writes the file.

    python3 server.py            # http://localhost:8000
    python3 server.py 8080       # another port

Binds 127.0.0.1 only: reachable from this machine, and from nowhere else on the
network. It is a local dev server, not something to expose.

Stdlib only, no install. Stop with Ctrl-C.
If you open index.html directly as a file:// page instead, the game still works —
it just falls back to browser storage, because there is no server to write to.
"""

import json
import os
import re
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit, parse_qs

HERE = os.path.dirname(os.path.abspath(__file__))
MAX_BODY = 1_000_000  # a progress file is a couple of KB; anything near this is wrong


def store_path(player):
    """Map a player name to their own file, never anyone else's.

    The name arrives as a URL query parameter, so it is untrusted input even
    though the page only ever sends its own sanitised player name — someone
    could still hit this endpoint directly. Keep only lowercase letters and
    digits, collapse everything else to a single hyphen, and cap the length.
    No player name (or one that sanitises to nothing) falls back to the
    original single-file behaviour, so saves from before this change still
    load.

    os.path.basename is a second, independent guard: even if the regex below
    somehow let a slash or ".." through, basename strips any directory
    component before it ever reaches a filesystem call, so a request can
    never be made to read or write outside this folder.
    """
    slug = re.sub(r"[^a-z0-9]+", "-", (player or "").strip().lower()).strip("-")[:40]
    name = ("progress-%s.json" % slug) if slug else "progress.json"
    return os.path.join(HERE, os.path.basename(name))


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=HERE, **kwargs)

    # --- helpers -----------------------------------------------------
    def _json(self, code, obj):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _is_progress(self):
        return self.path.split("?")[0].rstrip("/") in ("/progress", "/progress.json")

    def _store_path(self):
        qs = parse_qs(urlsplit(self.path).query)
        return store_path((qs.get("player") or [""])[0])

    # --- routes ------------------------------------------------------
    def do_GET(self):
        if self._is_progress():
            path = self._store_path()
            try:
                with open(path, "r", encoding="utf-8") as f:
                    return self._json(200, json.load(f))
            except FileNotFoundError:
                return self._json(200, {})
            except (json.JSONDecodeError, OSError) as e:
                # A corrupt file should not wipe anything — say so and let the
                # page carry on with whatever it has.
                print("  ! could not read %s: %s" % (os.path.basename(path), e), flush=True)
                return self._json(200, {})
        return super().do_GET()

    def do_POST(self):
        if not self._is_progress():
            return self._json(404, {"error": "not found"})
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            return self._json(400, {"error": "bad length"})
        if length <= 0 or length > MAX_BODY:
            return self._json(413, {"error": "bad size"})
        raw = self.rfile.read(length)
        try:
            data = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            return self._json(400, {"error": "not json"})
        if not isinstance(data, dict):
            return self._json(400, {"error": "expected an object"})

        path = self._store_path()

        # Write to a temp file and rename, so an interrupted save can never
        # leave a half-written progress file behind.
        tmp = path + ".tmp"
        try:
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2, ensure_ascii=False)
                f.write("\n")
            os.replace(tmp, path)
        except OSError as e:
            print("  ! could not write %s: %s" % (os.path.basename(path), e), flush=True)
            return self._json(500, {"error": "write failed"})

        done = len(data.get("done") or {})
        print("  saved %s  (%d stops, %s XP)" % (os.path.basename(path), done, data.get("xp", 0)), flush=True)
        return self._json(200, {"ok": True, "stops": done})

    def log_message(self, fmt, *args):
        # Quiet the per-request noise; the save line above is the useful one.
        pass


def main():
    # Every print here passes flush=True on purpose. Python block-buffers
    # stdout when it is a pipe rather than a terminal, and this process then
    # blocks in serve_forever() — so without the flush the banner below never
    # reaches whatever is reading us, and a caller waiting to learn the port
    # waits forever.
    port = 8000
    if len(sys.argv) > 1:
        try:
            port = int(sys.argv[1])
        except ValueError:
            print("Usage: python3 server.py [port]", flush=True)
            return 2

    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    port = server.server_address[1]  # real port, e.g. when 0 asked the OS to pick one
    existing = sorted(
        f for f in os.listdir(HERE)
        if f.startswith("progress") and f.endswith(".json")
    )
    print("", flush=True)
    print("  Loop Line running at  http://localhost:%d" % port, flush=True)
    print("  Each player gets their own file: progress-<name>.json", flush=True)
    if existing:
        print("  Found: %s" % ", ".join(existing), flush=True)
    else:
        print("  (created the first time each player wins a stop)", flush=True)
    print("", flush=True)
    print("  Ctrl-C to stop.", flush=True)
    print("", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n  Stopped. Everyone's progress is in their own progress-<name>.json.\n", flush=True)
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
